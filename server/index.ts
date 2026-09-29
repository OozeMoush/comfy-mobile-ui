import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  add,
  getById,
  listHistory,
  listJobs,
  update,
  type GenerationRecord,
  type Snapshot,
} from "./store.js";
import {
  buildWorkflow,
  extractFirstImage,
  fetchImage,
  fetchPromptHistory,
  pingComfy,
  queueWorkflow,
  workflowExists,
  workflowPath,
} from "./comfy.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 8787);

function json(res: http.ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) throw new Error("Request body too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function publicRecord(record: GenerationRecord) {
  return {
    ...record,
    imageUrl: record.image ? `/api/history/${record.id}/image` : null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function monitorJob(id: string) {
  const record = getById(id);
  if (!record) return;
  update(id, { status: "processing" });

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try {
      const entry = await fetchPromptHistory(record.promptId);
      if (entry) {
        const image = extractFirstImage(entry);
        if (image) {
          update(id, { status: "completed", completedAt: Date.now(), image });
          return;
        }

        const status = entry.status as { status_str?: string } | undefined;
        if (status?.status_str === "error") {
          update(id, {
            status: "failed",
            completedAt: Date.now(),
            error: "ComfyUI reported a workflow execution error.",
          });
          return;
        }
      }
    } catch {
      // Transient polling failure. Keep trying until timeout.
    }
    await sleep(1000);
  }

  update(id, {
    status: "failed",
    completedAt: Date.now(),
    error: "Timed out waiting for ComfyUI.",
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (method === "GET" && url.pathname === "/api/health") {
      let comfy = false;
      let comfyError: string | null = null;
      try {
        comfy = await pingComfy();
      } catch (error) {
        comfyError = error instanceof Error ? error.message : String(error);
      }
      return json(res, 200, {
        ok: true,
        comfy,
        comfyError,
        workflow: workflowExists(),
        workflowPath,
      });
    }

    if (method === "GET" && url.pathname === "/api/jobs") {
      return json(res, 200, listJobs().map(publicRecord));
    }

    if (method === "GET" && url.pathname === "/api/history") {
      return json(res, 200, listHistory().map(publicRecord));
    }

    if (method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req);
      const prompt = body.prompt;
      const negativePrompt = body.negativePrompt;
      if (typeof prompt !== "string" || typeof negativePrompt !== "string") {
        return json(res, 400, { error: "prompt and negativePrompt are required." });
      }

      const seed =
        typeof body.seed === "number" && Number.isInteger(body.seed)
          ? body.seed
          : Math.floor(Math.random() * 2_147_483_647);

      const snapshot: Snapshot = {
        selection:
          body.selection && typeof body.selection === "object"
            ? (body.selection as Record<string, string[]>)
            : {},
        extraPrompt: typeof body.extraPrompt === "string" ? body.extraPrompt : "",
        prompt,
        negativePrompt,
      };

      const workflow = buildWorkflow({ prompt, negativePrompt, seed });
      const queued = await queueWorkflow(workflow);
      const record: GenerationRecord = {
        id: randomUUID(),
        promptId: queued.prompt_id,
        status: "queued",
        createdAt: Date.now(),
        completedAt: null,
        error: null,
        seed,
        snapshot,
        parentGenerationId:
          typeof body.parentGenerationId === "string" ? body.parentGenerationId : null,
        image: null,
      };

      add(record);
      void monitorJob(record.id);
      return json(res, 202, publicRecord(record));
    }

    const imageMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/image$/);
    if (method === "GET" && imageMatch) {
      const record = getById(decodeURIComponent(imageMatch[1]));
      if (!record?.image) return json(res, 404, { error: "Image is not available." });
      const image = await fetchImage(record.image);
      res.writeHead(200, {
        "content-type": image.contentType,
        "content-length": image.body.length,
        "cache-control": "private, max-age=31536000, immutable",
      });
      res.end(image.body);
      return;
    }

    return json(res, 404, { error: "Not found." });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`API port ${port} is already in use.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Comfy bridge listening on http://${host}:${port}`);
  console.log(`ComfyUI target: ${process.env.COMFY_BASE_URL ?? "http://127.0.0.1:8188"}`);
});
