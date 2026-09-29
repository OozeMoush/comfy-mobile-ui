import fs from "node:fs";
import path from "node:path";

export type Snapshot = {
  selection: Record<string, string[]>;
  extraPrompt: string;
  prompt: string;
  negativePrompt: string;
};

export type StoredImage = {
  filename: string;
  subfolder: string;
  type: string;
};

export type GenerationStatus = "queued" | "processing" | "completed" | "failed";

export type GenerationRecord = {
  id: string;
  promptId: string;
  status: GenerationStatus;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  seed: number;
  snapshot: Snapshot;
  parentGenerationId: string | null;
  image: StoredImage | null;
};

const dataFile = path.join(process.cwd(), "server", "data", "history.json");

function load(): GenerationRecord[] {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8")) as GenerationRecord[];
  } catch {
    return [];
  }
}

let items = load();

function persist() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(items, null, 2), "utf8");
}

export function listAll() {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

export function listJobs() {
  return listAll().filter((item) => item.status === "queued" || item.status === "processing");
}

export function listHistory() {
  return listAll().filter((item) => item.status === "completed" || item.status === "failed");
}

export function getById(id: string) {
  return items.find((item) => item.id === id) ?? null;
}

export function add(record: GenerationRecord) {
  items.unshift(record);
  persist();
  return record;
}

export function update(id: string, patch: Partial<GenerationRecord>) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch };
  persist();
  return items[index];
}
