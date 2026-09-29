import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StoredImage } from "./store.js";

const comfyBaseUrl = process.env.COMFY_BASE_URL ?? "http://127.0.0.1:8188";
export const workflowPath =
  process.env.WORKFLOW_PATH ??
  path.join(process.cwd(), "server", "workflows", "base.json");

type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

type Workflow = Record<string, WorkflowNode>;

export function workflowExists() {
  return fs.existsSync(workflowPath);
}

function loadWorkflowTemplate(): Workflow {
  if (!workflowExists()) {
    throw new Error(
      `Workflow file is missing: ${workflowPath}. Export a ComfyUI workflow in API format and save it there.`,
    );
  }
  return JSON.parse(fs.readFileSync(workflowPath, "utf8")) as Workflow;
}

function cloneWorkflow(workflow: Workflow): Workflow {
  return JSON.parse(JSON.stringify(workflow)) as Workflow;
}

function linkedNodeId(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Expected a linked ComfyUI node input.");
  }
  return String(value[0]);
}

function findSampler(workflow: Workflow): WorkflowNode {
  const entry = Object.values(workflow).find((node) =>
    node.class_type === "KSampler" || node.class_type === "KSamplerAdvanced",
  );
  if (!entry) throw new Error("No KSampler/KSamplerAdvanced node found.");
  return entry;
}

export function buildWorkflow(params: {
  prompt: string;
  negativePrompt: string;
  seed: number;
}) {
  const workflow = cloneWorkflow(loadWorkflowTemplate());
  const sampler = findSampler(workflow);

  const positiveId = linkedNodeId(sampler.inputs.positive);
  const negativeId = linkedNodeId(sampler.inputs.negative);
  const positiveNode = workflow[positiveId];
  const negativeNode = workflow[negativeId];

  if (!positiveNode || !("text" in positiveNode.inputs)) {
    throw new Error("Could not resolve positive prompt text node from the sampler.");
  }
  if (!negativeNode || !("text" in negativeNode.inputs)) {
    throw new Error("Could not resolve negative prompt text node from the sampler.");
  }

  positiveNode.inputs.text = params.prompt;
  negativeNode.inputs.text = params.negativePrompt;

  if ("seed" in sampler.inputs) {
    sampler.inputs.seed = params.seed;
  } else if ("noise_seed" in sampler.inputs) {
    sampler.inputs.noise_seed = params.seed;
  } else {
    throw new Error("Sampler has neither seed nor noise_seed input.");
  }

  return workflow;
}

export async function pingComfy() {
  const response = await fetch(`${comfyBaseUrl}/system_stats`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`ComfyUI health check failed: HTTP ${response.status}`);
  return true;
}

export async function queueWorkflow(workflow: Workflow) {
  const response = await fetch(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: randomUUID(), prompt: workflow }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ComfyUI rejected workflow (HTTP ${response.status}): ${detail.slice(0, 500)}`);
  }
  return (await response.json()) as { prompt_id: string };
}

export async function fetchPromptHistory(promptId: string) {
  const response = await fetch(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`ComfyUI history failed: HTTP ${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  return (data[promptId] as Record<string, unknown> | undefined) ?? null;
}

export function extractFirstImage(historyEntry: Record<string, unknown>): StoredImage | null {
  const outputs = historyEntry.outputs;
  if (!outputs || typeof outputs !== "object") return null;

  for (const value of Object.values(outputs as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const images = (value as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) continue;
    const first = images[0] as Partial<StoredImage>;
    if (!first.filename || !first.type) continue;
    return {
      filename: first.filename,
      subfolder: first.subfolder ?? "",
      type: first.type,
    };
  }
  return null;
}

export async function fetchImage(image: StoredImage) {
  const url = new URL("/view", comfyBaseUrl);
  url.searchParams.set("filename", image.filename);
  url.searchParams.set("subfolder", image.subfolder);
  url.searchParams.set("type", image.type);

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ComfyUI image fetch failed: HTTP ${response.status}`);
  return {
    contentType: response.headers.get("content-type") ?? "image/png",
    body: Buffer.from(await response.arrayBuffer()),
  };
}
