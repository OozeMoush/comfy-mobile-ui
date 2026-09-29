import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Dice5,
  Grid3X3,
  Heart,
  History as HistoryIcon,
  Home,
  List,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { createGeneration, getHistory, getJobs, type ServerGeneration } from "./api";

type CategoryKey =
  | "character"
  | "outfit"
  | "body"
  | "pose"
  | "camera"
  | "expression"
  | "scene"
  | "lighting"
  | "style";

type Page = "generate" | "history" | "presets" | "settings";
type PanelTab = "favorites" | "recent" | "all";
type SelectMode = "single" | "multi";

type Preset = {
  id: string;
  name: string;
  positive: string[];
  negative: string[];
  favorite: boolean;
  custom?: boolean;
};

type Catalog = Record<CategoryKey, Preset[]>;
type Selection = Record<CategoryKey, string[]>;

type Snapshot = {
  selection: Selection;
  extraPrompt: string;
  prompt: string;
  negativePrompt: string;
};

type QueueJob = ServerGeneration;

type Generation = ServerGeneration & {
  imageFavorite: boolean;
  recipeFavorite: boolean;
};

const CATEGORY_DEFS: Array<{
  key: CategoryKey;
  label: string;
  mode: SelectMode;
}> = [
  { key: "character", label: "Character", mode: "single" },
  { key: "outfit", label: "Outfit", mode: "multi" },
  { key: "body", label: "Body", mode: "multi" },
  { key: "pose", label: "Pose", mode: "single" },
  { key: "camera", label: "Camera", mode: "single" },
  { key: "expression", label: "Expression", mode: "single" },
  { key: "scene", label: "Scene", mode: "single" },
  { key: "lighting", label: "Lighting", mode: "single" },
  { key: "style", label: "Style", mode: "single" },
];

const DEFAULT_GLOBAL_NEGATIVE =
  "worst quality, low quality, blurry, bad anatomy, malformed hands, extra fingers";

const DEFAULT_CATALOG: Catalog = {
  character: [
    preset("char-gura", "Gawr Gura", ["gawr gura", "blue eyes", "silver hair"], [], true),
    preset("char-aqua", "Minato Aqua", ["minato aqua", "pink hair"], [], true),
    preset("char-watame", "Tsunomaki Watame", ["tsunomaki watame"], [], false),
    preset("char-hajime", "Todoroki Hajime", ["todoroki hajime"], [], false),
    preset("char-original", "Original character", ["1girl"], [], false),
  ],
  outfit: [
    preset("outfit-hoodie", "Casual Hoodie", ["oversized hoodie", "short shorts"], [], true),
    preset("outfit-school", "School Uniform", ["school uniform", "pleated skirt", "ribbon"], [], true),
    preset("outfit-maid", "Maid Outfit", ["maid", "frilled dress", "apron"], [], true),
    preset("outfit-sports", "Sportswear", ["sportswear", "track jacket"], [], false),
    preset("outfit-dress", "Summer Dress", ["summer dress", "light fabric"], [], false),
  ],
  body: [
    preset("body-solo", "Solo", ["solo"], ["2girls", "multiple girls", "crowd"], true),
    preset("body-clean-hands", "Hands Priority", ["detailed hands"], ["bad hands", "extra fingers"], false),
    preset("body-natural", "Natural Proportions", ["natural proportions"], ["deformed body"], true),
  ],
  pose: [
    preset("pose-sitting", "Sitting", ["sitting"], ["standing"], true),
    preset("pose-standing", "Standing", ["standing"], ["sitting"], true),
    preset("pose-walking", "Walking", ["walking", "dynamic pose"], [], false),
    preset("pose-lean", "Leaning Forward", ["leaning forward"], [], false),
    preset("pose-hands-back", "Hands Behind Back", ["hands behind back"], [], false),
  ],
  camera: [
    preset("cam-upper", "Upper Body", ["upper body"], [], true),
    preset("cam-cowboy", "Cowboy Shot", ["cowboy shot"], [], true),
    preset("cam-full", "Full Body", ["full body"], [], false),
    preset("cam-portrait", "Portrait", ["portrait"], [], false),
    preset("cam-low", "Low Angle", ["low angle"], [], false),
  ],
  expression: [
    preset("expr-smile", "Gentle Smile", ["gentle smile"], [], true),
    preset("expr-serious", "Serious", ["serious expression"], [], false),
    preset("expr-laugh", "Laughing", ["laughing", "open mouth"], [], true),
    preset("expr-sleepy", "Sleepy", ["sleepy", "half-closed eyes"], [], false),
    preset("expr-surprise", "Surprised", ["surprised"], [], false),
  ],
  scene: [
    preset("scene-bedroom", "Bedroom", ["bedroom", "cozy interior"], [], true),
    preset("scene-cafe", "Cafe", ["cafe interior"], [], true),
    preset("scene-city", "City Night", ["city at night", "street"], [], false),
    preset("scene-classroom", "Classroom", ["classroom"], [], false),
    preset("scene-beach", "Beach", ["beach", "ocean"], [], false),
  ],
  lighting: [
    preset("light-soft", "Soft Evening", ["soft evening light"], [], true),
    preset("light-window", "Window Light", ["soft window light"], [], true),
    preset("light-neon", "Neon Rim", ["neon rim light"], [], false),
    preset("light-golden", "Golden Hour", ["golden hour"], [], false),
    preset("light-overcast", "Overcast Soft", ["soft overcast lighting"], [], false),
  ],
  style: [
    preset("style-clean", "Clean Anime", ["clean anime illustration"], [], true),
    preset("style-soft", "Soft Illustration", ["soft illustration", "delicate shading"], [], true),
    preset("style-detailed", "Detailed Painting", ["highly detailed digital painting"], [], false),
    preset("style-flat", "Flat Cel", ["cel shading", "flat colors"], [], false),
  ],
};

const DEFAULT_SELECTION: Selection = {
  character: ["char-gura"],
  outfit: ["outfit-hoodie"],
  body: ["body-solo"],
  pose: ["pose-sitting"],
  camera: ["cam-upper"],
  expression: ["expr-smile"],
  scene: ["scene-bedroom"],
  lighting: ["light-soft"],
  style: ["style-clean"],
};

const STORAGE = {
  catalog: "comfy-mobile-ui.catalog",
  selection: "comfy-mobile-ui.selection",
  extraPrompt: "comfy-mobile-ui.extraPrompt",
  globalNegative: "comfy-mobile-ui.globalNegative",
  recent: "comfy-mobile-ui.recent",
} as const;

function preset(
  id: string,
  name: string,
  positive: string[],
  negative: string[],
  favorite: boolean,
): Preset {
  return { id, name, positive, negative, favorite };
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function findPreset(catalog: Catalog, category: CategoryKey, id: string) {
  return catalog[category].find((item) => item.id === id);
}

function buildPrompt(
  catalog: Catalog,
  selection: Selection,
  extraPrompt: string,
  globalNegative: string,
) {
  const positive = ["masterpiece", "best quality"];
  const negative = [globalNegative];

  for (const { key } of CATEGORY_DEFS) {
    for (const id of selection[key]) {
      const item = findPreset(catalog, key, id);
      if (!item) continue;
      positive.push(...item.positive);
      negative.push(...item.negative);
    }
  }

  if (extraPrompt.trim()) positive.push(extraPrompt.trim());

  return {
    prompt: positive.filter(Boolean).join(", "),
    negativePrompt: negative.filter(Boolean).join(", "),
  };
}

function previewStyle(seed: number) {
  const a = seed % 360;
  const b = (a + 72) % 360;
  const c = (a + 188) % 360;
  return {
    backgroundImage: `
      radial-gradient(circle at 72% 18%, hsl(${b} 82% 72% / .86), transparent 28%),
      radial-gradient(circle at 28% 66%, hsl(${c} 74% 55% / .72), transparent 34%),
      linear-gradient(145deg, hsl(${a} 42% 19%), hsl(${b} 52% 31%))
    `,
  };
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog>(() =>
    loadLocal(STORAGE.catalog, DEFAULT_CATALOG),
  );
  const [selection, setSelection] = useState<Selection>(() =>
    loadLocal(STORAGE.selection, DEFAULT_SELECTION),
  );
  const [extraPrompt, setExtraPrompt] = useState(() =>
    loadLocal(STORAGE.extraPrompt, ""),
  );
  const [globalNegative, setGlobalNegative] = useState(() =>
    loadLocal(STORAGE.globalNegative, DEFAULT_GLOBAL_NEGATIVE),
  );
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    loadLocal(STORAGE.recent, []),
  );
  const [history, setHistory] = useState<Generation[]>([]);
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [page, setPage] = useState<Page>("generate");
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("favorites");
  const [panelSearch, setPanelSearch] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [lockedSeed, setLockedSeed] = useState<number | null>(null);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");

  const restoredPreviousState = useMemo(
    () => localStorage.getItem(STORAGE.selection) !== null,
    [],
  );

  useEffect(() => localStorage.setItem(STORAGE.catalog, JSON.stringify(catalog)), [catalog]);
  useEffect(() => localStorage.setItem(STORAGE.selection, JSON.stringify(selection)), [selection]);
  useEffect(() => localStorage.setItem(STORAGE.extraPrompt, JSON.stringify(extraPrompt)), [extraPrompt]);
  useEffect(
    () => localStorage.setItem(STORAGE.globalNegative, JSON.stringify(globalNegative)),
    [globalNegative],
  );
  useEffect(() => localStorage.setItem(STORAGE.recent, JSON.stringify(recentIds)), [recentIds]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [jobs, records] = await Promise.all([getJobs(), getHistory()]);
        if (cancelled) return;

        setQueue(jobs);
        setHistory((current) =>
          records.map((record) => {
            const previous = current.find((item) => item.id === record.id);
            return {
              ...record,
              imageFavorite: previous?.imageFavorite ?? false,
              recipeFavorite: previous?.recipeFavorite ?? false,
            };
          }),
        );
      } catch (error) {
        console.error("Failed to refresh ComfyUI bridge state", error);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const currentPrompt = useMemo(
    () => buildPrompt(catalog, selection, extraPrompt, globalNegative),
    [catalog, selection, extraPrompt, globalNegative],
  );

  const latest = history[0] ?? null;
  const activeQueueCount = queue.length;

  function markRecent(id: string) {
    setRecentIds((items) => [id, ...items.filter((value) => value !== id)].slice(0, 30));
  }

  function choosePreset(category: CategoryKey, id: string) {
    const def = CATEGORY_DEFS.find((item) => item.key === category)!;
    setSelection((current) => {
      const selected = current[category];
      const next =
        def.mode === "single"
          ? [id]
          : selected.includes(id)
            ? selected.filter((value) => value !== id)
            : [...selected, id];
      return { ...current, [category]: next };
    });
    markRecent(id);
    if (def.mode === "single") setActiveCategory(null);
  }

  function togglePresetFavorite(category: CategoryKey, id: string) {
    setCatalog((current) => ({
      ...current,
      [category]: current[category].map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item,
      ),
    }));
  }

  function randomizeCategory(category: CategoryKey) {
    const options = catalog[category];
    if (!options.length) return;
    const item = options[Math.floor(Math.random() * options.length)];
    setSelection((current) => ({ ...current, [category]: [item.id] }));
    markRecent(item.id);
  }

  function randomizeAllExceptCharacter() {
    setSelection((current) => {
      const next = { ...current };
      for (const { key } of CATEGORY_DEFS) {
        if (key === "character") continue;
        const options = catalog[key];
        if (!options.length) continue;
        const item = options[Math.floor(Math.random() * options.length)];
        next[key] = [item.id];
        markRecent(item.id);
      }
      return next;
    });
  }

  async function submitGeneration(
    snapshot: Snapshot,
    parentGenerationId: string | null,
    seed?: number,
  ) {
    const record = await createGeneration({
      prompt: snapshot.prompt,
      negativePrompt: snapshot.negativePrompt,
      selection: snapshot.selection,
      extraPrompt: snapshot.extraPrompt,
      parentGenerationId,
      seed,
    });
    setQueue((items) => [...items.filter((item) => item.id !== record.id), record]);
  }

  async function generateCurrent() {
    const snapshot: Snapshot = {
      selection: structuredClone(selection),
      extraPrompt,
      prompt: currentPrompt.prompt,
      negativePrompt: currentPrompt.negativePrompt,
    };

    try {
      await submitGeneration(snapshot, currentParentId, lockedSeed ?? undefined);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function repeatGeneration(item: Generation) {
    try {
      await submitGeneration(structuredClone(item.snapshot) as Snapshot, item.id);
      setPage("generate");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function restoreGeneration(item: Generation) {
    setSelection(structuredClone(item.snapshot.selection));
    setExtraPrompt(item.snapshot.extraPrompt);
    setLockedSeed(null);
    setCurrentParentId(item.id);
    setPage("generate");
  }

  function useGenerationSeed(item: Generation) {
    restoreGeneration(item);
    setLockedSeed(item.seed);
  }

  function toggleGenerationFlag(
    id: string,
    flag: "imageFavorite" | "recipeFavorite",
  ) {
    setHistory((items) =>
      items.map((item) =>
        item.id === id ? { ...item, [flag]: !item[flag] } : item,
      ),
    );
  }

  function resetWorkingState() {
    setSelection(DEFAULT_SELECTION);
    setExtraPrompt("");
    setLockedSeed(null);
    setCurrentParentId(null);
  }

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((item) =>
      `${item.snapshot.prompt} ${item.snapshot.negativePrompt}`
        .toLowerCase()
        .includes(query),
    );
  }, [history, historySearch]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LOCAL GENERATION CONTROL</div>
          <h1>Comfy Mobile UI</h1>
        </div>
        <button className="queue-button" onClick={() => setQueueOpen(true)}>
          <List size={18} />
          Queue
          <span>{activeQueueCount}</span>
        </button>
      </header>

      {restoredPreviousState && page === "generate" && (
        <div className="restore-banner">
          Previous setup restored. Nothing runs until you press Generate.
        </div>
      )}

      <main className="main-content">
        {page === "generate" && (
          <GeneratePage
            catalog={catalog}
            selection={selection}
            extraPrompt={extraPrompt}
            setExtraPrompt={setExtraPrompt}
            setActiveCategory={(key) => {
              setPanelSearch("");
              setPanelTab("favorites");
              setActiveCategory(key);
            }}
            randomizeAll={randomizeAllExceptCharacter}
            generateCurrent={generateCurrent}
            latest={latest}
            lockedSeed={lockedSeed}
            repeatGeneration={repeatGeneration}
            restoreGeneration={restoreGeneration}
            useGenerationSeed={useGenerationSeed}
            toggleGenerationFlag={toggleGenerationFlag}
            prompt={currentPrompt.prompt}
            negativePrompt={currentPrompt.negativePrompt}
          />
        )}

        {page === "history" && (
          <HistoryPage
            items={filteredHistory}
            search={historySearch}
            setSearch={setHistorySearch}
            restoreGeneration={restoreGeneration}
            repeatGeneration={repeatGeneration}
            toggleGenerationFlag={toggleGenerationFlag}
          />
        )}

        {page === "presets" && (
          <PresetsPage catalog={catalog} setCatalog={setCatalog} />
        )}

        {page === "settings" && (
          <SettingsPage
            globalNegative={globalNegative}
            setGlobalNegative={setGlobalNegative}
            resetWorkingState={resetWorkingState}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton
          active={page === "generate"}
          label="Generate"
          icon={<Home size={20} />}
          onClick={() => setPage("generate")}
        />
        <NavButton
          active={page === "history"}
          label="History"
          icon={<HistoryIcon size={20} />}
          onClick={() => setPage("history")}
        />
        <NavButton
          active={page === "presets"}
          label="Presets"
          icon={<SlidersHorizontal size={20} />}
          onClick={() => setPage("presets")}
        />
        <NavButton
          active={page === "settings"}
          label="Settings"
          icon={<Settings size={20} />}
          onClick={() => setPage("settings")}
        />
      </nav>

      {activeCategory && (
        <SelectionPanel
          category={activeCategory}
          catalog={catalog}
          selection={selection}
          tab={panelTab}
          setTab={setPanelTab}
          search={panelSearch}
          setSearch={setPanelSearch}
          recentIds={recentIds}
          onClose={() => setActiveCategory(null)}
          onChoose={choosePreset}
          onFavorite={togglePresetFavorite}
          onRandom={randomizeCategory}
        />
      )}

      {queueOpen && (
        <QueuePanel queue={queue} onClose={() => setQueueOpen(false)} />
      )}
    </div>
  );
}

function GeneratePage(props: {
  catalog: Catalog;
  selection: Selection;
  extraPrompt: string;
  setExtraPrompt: (value: string) => void;
  setActiveCategory: (key: CategoryKey) => void;
  randomizeAll: () => void;
  generateCurrent: () => void;
  latest: Generation | null;
  lockedSeed: number | null;
  repeatGeneration: (item: Generation) => void;
  restoreGeneration: (item: Generation) => void;
  useGenerationSeed: (item: Generation) => void;
  toggleGenerationFlag: (
    id: string,
    flag: "imageFavorite" | "recipeFavorite",
  ) => void;
  prompt: string;
  negativePrompt: string;
}) {
  return (
    <div className="generate-layout">
      <section className="config-column">
        <div className="section-heading">
          <div>
            <div className="eyebrow">BUILD FROM A RECIPE</div>
            <h2>Generation setup</h2>
          </div>
          <button className="ghost-button" onClick={props.randomizeAll}>
            <Dice5 size={18} />
            Randomize
          </button>
        </div>

        <div className="attribute-grid">
          {CATEGORY_DEFS.map((def) => {
            const selected = props.selection[def.key]
              .map((id) => findPreset(props.catalog, def.key, id)?.name)
              .filter(Boolean);

            return (
              <button
                key={def.key}
                className="attribute-card"
                onClick={() => props.setActiveCategory(def.key)}
              >
                <span className="attribute-label">
                  {def.label}
                  {def.mode === "multi" && <small>multi</small>}
                </span>
                <span className={selected.length ? "attribute-value" : "attribute-empty"}>
                  {selected.length ? selected.join(" + ") : "Choose"}
                </span>
                <ChevronRight size={20} />
              </button>
            );
          })}
        </div>

        <label className="field-block">
          <span>Extra Prompt</span>
          <textarea
            value={props.extraPrompt}
            onChange={(event) => props.setExtraPrompt(event.target.value)}
            placeholder="Add one-off details without creating a preset..."
            rows={3}
          />
        </label>

        <details className="prompt-details">
          <summary>Composed prompt</summary>
          <div>
            <strong>Positive</strong>
            <p>{props.prompt}</p>
          </div>
          <div>
            <strong>Negative</strong>
            <p>{props.negativePrompt}</p>
          </div>
        </details>

        <div className="generate-action">
          <button className="primary-button" onClick={props.generateCurrent}>
            <Sparkles size={20} />
            Generate
            {props.lockedSeed !== null && (
              <span className="seed-chip">Seed {props.lockedSeed}</span>
            )}
          </button>
        </div>
      </section>

      <section className="result-column">
        <div className="section-heading">
          <div>
            <div className="eyebrow">LATEST</div>
            <h2>Result</h2>
          </div>
        </div>

        {props.latest ? (
          <GenerationCard
            item={props.latest}
            large
            onRestore={() => props.restoreGeneration(props.latest!)}
            onRepeat={() => props.repeatGeneration(props.latest!)}
            onUseSeed={() => props.useGenerationSeed(props.latest!)}
            onImageFavorite={() =>
              props.toggleGenerationFlag(props.latest!.id, "imageFavorite")
            }
            onRecipeFavorite={() =>
              props.toggleGenerationFlag(props.latest!.id, "recipeFavorite")
            }
          />
        ) : (
          <div className="empty-preview">
            <Sparkles size={30} />
            <strong>No generations yet</strong>
            <span>Generate once to start the working history.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function SelectionPanel(props: {
  category: CategoryKey;
  catalog: Catalog;
  selection: Selection;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  search: string;
  setSearch: (value: string) => void;
  recentIds: string[];
  onClose: () => void;
  onChoose: (category: CategoryKey, id: string) => void;
  onFavorite: (category: CategoryKey, id: string) => void;
  onRandom: (category: CategoryKey) => void;
}) {
  const def = CATEGORY_DEFS.find((item) => item.key === props.category)!;
  const all = props.catalog[props.category];

  const visible = useMemo(() => {
    let items = all;

    if (props.tab === "favorites") {
      items = all.filter((item) => item.favorite);
    } else if (props.tab === "recent") {
      items = props.recentIds
        .map((id) => all.find((item) => item.id === id))
        .filter((item): item is Preset => Boolean(item));
    }

    const query = props.search.trim().toLowerCase();
    if (query) {
      items = items.filter((item) =>
        `${item.name} ${item.positive.join(" ")} ${item.negative.join(" ")}`
          .toLowerCase()
          .includes(query),
      );
    }

    return items;
  }, [all, props.recentIds, props.search, props.tab]);

  return (
    <div className="fullscreen-panel">
      <div className="panel-shell">
        <header className="panel-header">
          <div>
            <div className="eyebrow">{def.mode.toUpperCase()} SELECT</div>
            <h2>{def.label}</h2>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close">
            <X size={24} />
          </button>
        </header>

        <label className="search-box">
          <Search size={19} />
          <input
            autoFocus
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
            placeholder={`Search ${def.label.toLowerCase()} presets`}
          />
        </label>

        <div className="segmented-tabs">
          <button
            className={props.tab === "favorites" ? "active" : ""}
            onClick={() => props.setTab("favorites")}
          >
            <Star size={17} /> Favorites
          </button>
          <button
            className={props.tab === "recent" ? "active" : ""}
            onClick={() => props.setTab("recent")}
          >
            <Clock3 size={17} /> Recent
          </button>
          <button
            className={props.tab === "all" ? "active" : ""}
            onClick={() => props.setTab("all")}
          >
            <Grid3X3 size={17} /> All
          </button>
        </div>

        <button className="random-row" onClick={() => props.onRandom(props.category)}>
          <Dice5 size={20} />
          Random {def.label}
        </button>

        <div className="preset-list">
          {visible.map((item) => {
            const selected = props.selection[props.category].includes(item.id);
            return (
              <div
                key={item.id}
                className={`preset-row ${selected ? "selected" : ""}`}
              >
                <button
                  className="preset-main"
                  onClick={() => props.onChoose(props.category, item.id)}
                >
                  <span className="check-slot">
                    {selected && <Check size={18} />}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.positive.join(", ")}</small>
                  </span>
                </button>
                <button
                  className={`star-button ${item.favorite ? "active" : ""}`}
                  onClick={() => props.onFavorite(props.category, item.id)}
                  aria-label="Toggle preset favorite"
                >
                  <Star size={19} fill={item.favorite ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}

          {!visible.length && (
            <div className="empty-list">
              No presets in this view. Switch tabs or change the search.
            </div>
          )}
        </div>

        {def.mode === "multi" && (
          <button className="panel-done" onClick={props.onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function GenerationCard(props: {
  item: Generation;
  large?: boolean;
  onRestore: () => void;
  onRepeat: () => void;
  onUseSeed: () => void;
  onImageFavorite: () => void;
  onRecipeFavorite: () => void;
}) {
  return (
    <article className={`generation-card ${props.large ? "large" : ""}`}>
      {props.item.imageUrl ? (
        <img className="result-image" src={props.item.imageUrl} alt="" />
      ) : (
        <div className="mock-image" style={previewStyle(props.item.seed)}>
          <span>{props.item.status === "failed" ? "Generation failed" : "Waiting for image"}</span>
          <strong>{props.item.seed}</strong>
        </div>
      )}

      <div className="generation-meta">
        <span>Seed {props.item.seed}</span>
        <span>{new Date(props.item.createdAt).toLocaleTimeString()}</span>
      </div>

      <div className="result-actions">
        <button
          className={props.item.imageFavorite ? "active" : ""}
          onClick={props.onImageFavorite}
          title="Favorite image"
        >
          <Heart
            size={18}
            fill={props.item.imageFavorite ? "currentColor" : "none"}
          />
          Image
        </button>
        <button
          className={props.item.recipeFavorite ? "active" : ""}
          onClick={props.onRecipeFavorite}
          title="Favorite recipe"
        >
          <Bookmark
            size={18}
            fill={props.item.recipeFavorite ? "currentColor" : "none"}
          />
          Recipe
        </button>
        <button onClick={props.onRepeat} title="Generate again with a new seed">
          <RotateCcw size={18} />
          Again
        </button>
        <button onClick={props.onUseSeed} title="Restore this setup and lock its seed">
          <Lock size={18} />
          Seed
        </button>
      </div>

      <button className="restore-button" onClick={props.onRestore}>
        Restore this setup
      </button>
    </article>
  );
}

function HistoryPage(props: {
  items: Generation[];
  search: string;
  setSearch: (value: string) => void;
  restoreGeneration: (item: Generation) => void;
  repeatGeneration: (item: Generation) => void;
  toggleGenerationFlag: (
    id: string,
    flag: "imageFavorite" | "recipeFavorite",
  ) => void;
}) {
  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <div className="eyebrow">SEARCHABLE GENERATION LIBRARY</div>
          <h2>History</h2>
        </div>
        <span className="count-chip">{props.items.length}</span>
      </div>

      <label className="search-box history-search">
        <Search size={19} />
        <input
          value={props.search}
          onChange={(event) => props.setSearch(event.target.value)}
          placeholder="Search prompt, character, outfit..."
        />
      </label>

      {props.items.length ? (
        <div className="history-grid">
          {props.items.map((item) => (
            <GenerationCard
              key={item.id}
              item={item}
              onRestore={() => props.restoreGeneration(item)}
              onRepeat={() => props.repeatGeneration(item)}
              onUseSeed={() => {
                props.restoreGeneration(item);
              }}
              onImageFavorite={() =>
                props.toggleGenerationFlag(item.id, "imageFavorite")
              }
              onRecipeFavorite={() =>
                props.toggleGenerationFlag(item.id, "recipeFavorite")
              }
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <HistoryIcon size={30} />
          <strong>No matching generations</strong>
          <span>Your generated images and metadata will appear here.</span>
        </div>
      )}
    </section>
  );
}

function PresetsPage(props: {
  catalog: Catalog;
  setCatalog: (updater: (current: Catalog) => Catalog) => void;
}) {
  const [category, setCategory] = useState<CategoryKey>("outfit");
  const [name, setName] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [favorite, setFavorite] = useState(true);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !positive.trim()) return;

    const item: Preset = {
      id: uid(`custom-${category}`),
      name: name.trim(),
      positive: positive
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      negative: negative
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      favorite,
      custom: true,
    };

    props.setCatalog((current) => ({
      ...current,
      [category]: [...current[category], item],
    }));
    setName("");
    setPositive("");
    setNegative("");
  }

  return (
    <section className="page-section presets-layout">
      <div className="section-heading">
        <div>
          <div className="eyebrow">REUSABLE BUILDING BLOCKS</div>
          <h2>Presets</h2>
        </div>
      </div>

      <form className="preset-form" onSubmit={submit}>
        <label className="field-block">
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CategoryKey)}
          >
            {CATEGORY_DEFS.map((item) => (
              <option value={item.key} key={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-block">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Oversized Hoodie"
          />
        </label>

        <label className="field-block">
          <span>Positive tags</span>
          <textarea
            rows={4}
            value={positive}
            onChange={(event) => setPositive(event.target.value)}
            placeholder="oversized hoodie, shark motif, short shorts"
          />
        </label>

        <label className="field-block">
          <span>Negative tags</span>
          <textarea
            rows={3}
            value={negative}
            onChange={(event) => setNegative(event.target.value)}
            placeholder="school uniform"
          />
        </label>

        <label className="favorite-toggle">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(event) => setFavorite(event.target.checked)}
          />
          Add to Favorites
        </label>

        <button className="secondary-button" type="submit">
          <Plus size={18} />
          Add preset
        </button>
      </form>

      <div className="preset-summary">
        <h3>{CATEGORY_DEFS.find((item) => item.key === category)?.label}</h3>
        {props.catalog[category].map((item) => (
          <div className="summary-row" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <small>{item.positive.join(", ")}</small>
            </div>
            {item.favorite && <Star size={17} fill="currentColor" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage(props: {
  globalNegative: string;
  setGlobalNegative: (value: string) => void;
  resetWorkingState: () => void;
}) {
  return (
    <section className="page-section settings-page">
      <div className="section-heading">
        <div>
          <div className="eyebrow">GLOBAL BEHAVIOR</div>
          <h2>Settings</h2>
        </div>
      </div>

      <label className="field-block">
        <span>Global Negative Prompt</span>
        <textarea
          rows={5}
          value={props.globalNegative}
          onChange={(event) => props.setGlobalNegative(event.target.value)}
        />
        <small>
          Attribute-level negatives are appended automatically after this.
        </small>
      </label>

      <div className="settings-card">
        <strong>ComfyUI connection</strong>
        <span>Local bridge enabled. Open /api/health to verify ComfyUI and the workflow file.</span>
        <span className="status-pill">Bridge mode</span>
      </div>

      <button className="ghost-button" onClick={props.resetWorkingState}>
        <RotateCcw size={18} />
        Reset working setup
      </button>
    </section>
  );
}

function QueuePanel(props: { queue: QueueJob[]; onClose: () => void }) {
  return (
    <div className="fullscreen-panel queue-panel">
      <div className="panel-shell">
        <header className="panel-header">
          <div>
            <div className="eyebrow">GPU WORK</div>
            <h2>Queue</h2>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close">
            <X size={24} />
          </button>
        </header>

        {props.queue.length ? (
          <div className="queue-list">
            {props.queue.map((job, index) => (
              <div className="queue-row" key={job.id}>
                <span className={`queue-status ${job.status}`} />
                <div>
                  <strong>
                    {job.status === "processing" ? "Generating" : `Queued #${index + 1}`}
                  </strong>
                  <small>Seed {job.seed}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <List size={30} />
            <strong>Queue is empty</strong>
            <span>Rapid taps on Generate will stack jobs here.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function NavButton(props: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={props.active ? "active" : ""} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
