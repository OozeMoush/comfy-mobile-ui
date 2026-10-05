# comfy-mobile-ui

Mobile-first web UI for driving a local ComfyUI instance from a PC or phone.

## Project source of truth

This repository is the canonical durable project state.

A new ChatGPT session or coding agent should be able to recover the project without previous chat history by reading:

1. this README
2. [docs/product.md](docs/product.md)
3. [docs/architecture.md](docs/architecture.md)
4. [docs/development.md](docs/development.md)
5. open GitHub Issues / relevant PRs
6. source code and CI

Important product or architecture decisions made in ChatGPT/Codex conversations should be written back to README/docs/Issues rather than left only in chat.

For coding agents, see [AGENTS.md](AGENTS.md).

For the ChatGPT web Project, use [docs/chatgpt-project-instructions.md](docs/chatgpt-project-instructions.md) as the Project Instructions baseline.

## Current development split

- **Local Codex:** primary implementation, local debugging, tests, commits/PRs
- **ChatGPT Project:** requirements, UX, architecture, Issue shaping, implementation review
- **GitHub:** shared source of truth between both

See [docs/development.md](docs/development.md).

For guarded Local Codex startup from this repository, use `node scripts/codex-local.mjs` (or `--check` for preflight only). See [local isolation and validation limits](docs/local-codex-isolation.md). The startup guard must pass before isolation is treated as verified.

## Ports

- Web UI: `0.0.0.0:5178`
- Local API bridge: `127.0.0.1:8787`
- ComfyUI default target: `127.0.0.1:8188`

The API bridge is intentionally **not exposed to the LAN/Tailscale interface**. Browsers access it through the Vite `/api` proxy on port 5178.

## Setup

### 1. Export the ComfyUI workflow

Export the workflow you want to use in **API format** and save it as:

```text
server/workflows/base.json
```

The current bridge expects one KSampler/KSamplerAdvanced whose positive and negative inputs ultimately point at text nodes with a `text` input. The sampler seed/noise_seed is replaced for each generation.

### 2. Start ComfyUI

The default target is:

```text
http://127.0.0.1:8188
```

Override it if necessary:

```bash
COMFY_BASE_URL=http://127.0.0.1:8188 npm run dev
```

### 3. Start the app

```bash
npm install
npm run dev
```

Then open on the PC:

```text
http://localhost:5178
```

For a phone, open port 5178 through the PC's reachable LAN/Tailscale address.

## Connection check

With the app running, open:

```text
http://localhost:5178/api/health
```

A ready setup should report both:

```json
{
  "comfy": true,
  "workflow": true
}
```

If `comfy` is false, ComfyUI is not reachable at the configured URL.
If `workflow` is false, `server/workflows/base.json` has not been added yet.

## Current features

- attribute-card based prompt building
- Favorites / Recent / All selector tabs
- single/multi-select attributes
- per-attribute and broad randomization
- positive + attribute-level negative prompt composition
- explicit Generate with independent queued snapshots
- real ComfyUI submission through the local bridge
- server-side polling of ComfyUI job history
- generated image retrieval through the bridge
- searchable generation history
- image/recipe favorites remain UI-local for now
- recipe restore and seed reuse
- custom presets
- global negative prompt
- PWA shell

## Current persistence

Generation metadata is stored locally in:

```text
server/data/history.json
```

This is intentionally simple for the first connected prototype. SQLite can replace it once the interaction model settles.

## Current verification status

The repository contains the connected bridge implementation and CI build/type checks pass.

The remaining important verification is against the user's **actual local ComfyUI API-format workflow** and real GPU environment. Track that work in the active GitHub Issue rather than relying on chat history.
