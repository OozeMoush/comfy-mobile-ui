export type ServerGeneration = {
  id: string;
  promptId: string;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  seed: number;
  snapshot: {
    selection: Record<string, string[]>;
    extraPrompt: string;
    prompt: string;
    negativePrompt: string;
  };
  parentGenerationId: string | null;
  imageUrl: string | null;
};

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function getHealth() {
  return parse<{
    ok: boolean;
    comfy: boolean;
    comfyError: string | null;
    workflow: boolean;
    workflowPath: string;
  }>(await fetch("/api/health", { cache: "no-store" }));
}

export async function createGeneration(payload: {
  prompt: string;
  negativePrompt: string;
  selection: Record<string, string[]>;
  extraPrompt: string;
  parentGenerationId: string | null;
  seed?: number;
}) {
  return parse<ServerGeneration>(
    await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getJobs() {
  return parse<ServerGeneration[]>(await fetch("/api/jobs", { cache: "no-store" }));
}

export async function getHistory() {
  return parse<ServerGeneration[]>(await fetch("/api/history", { cache: "no-store" }));
}
