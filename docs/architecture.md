# Architecture

## Principles

- GitHub repository is the source of truth for implementation and architecture.
- The browser must not depend on ComfyUI node IDs.
- ComfyUI workflow details belong behind a thin local bridge.
- ComfyUI should not be exposed directly to the public Internet.
- PC browser and phone must use the same web application.
- The implementation should stay simple until real use proves a need for more infrastructure.

## Current topology

```text
PC browser / Phone PWA
        |
        | HTTP
        v
Vite web UI
0.0.0.0:5178
        |
        | /api proxy
        v
Local API bridge
127.0.0.1:8787
        |
        | ComfyUI HTTP API
        v
ComfyUI
127.0.0.1:8188
        |
        v
Home GPU + local output storage
```

### Port policy

- Web UI: fixed at `5178`
- API bridge: fixed at `8787`
- ComfyUI: expected at `8188`

Vite uses `strictPort: true` so a collision fails explicitly instead of silently moving to another port.

The Web UI binds to `0.0.0.0` so Windows/browser and phone access are possible.

The API bridge binds to `127.0.0.1` and is reached through Vite's `/api` proxy. It is not intended to be directly exposed over LAN/Tailscale.

## Remote access

Remote phone access is intended through Tailscale to port 5178 on the host.

Do not expose ComfyUI port 8188 directly to the public Internet.

The exact WSL/Tailscale routing may depend on the host setup and should be validated on the real machine rather than assumed from repository code alone.

## Frontend

Current frontend:

- React
- TypeScript
- Vite
- responsive/mobile-first PWA shell

The frontend owns interaction state such as:

- selected attribute presets
- Extra Prompt
- current recipe editing
- picker Favorites / Recent / All presentation

Generation submission is through the local bridge.

## Prompt composition

Each attribute preset can contain:

```ts
{
  positive: string[],
  negative: string[]
}
```

Final prompt conceptually becomes:

```text
Positive =
  selected preset positives in stable category order
  + Extra Prompt

Negative =
  Global Negative
  + selected preset negatives
```

No semantic contradiction resolver is planned in the MVP.

## Local API bridge

The bridge currently exists under `server/`.

Responsibilities:

- load an API-format ComfyUI workflow template
- replace positive prompt
- replace negative prompt
- replace seed/noise seed
- submit the workflow to ComfyUI
- poll ComfyUI history
- expose generated image bytes through the app API
- persist generation metadata locally

The frontend should not know workflow node IDs.

## Workflow

Expected workflow location:

```text
server/workflows/base.json
```

This should be exported from the user's actual ComfyUI workflow in API format.

Important: repository code currently contains the bridge logic, but successful execution against the user's real local workflow must be verified locally.

## Persistence

Current connected prototype uses:

```text
server/data/history.json
```

This is intentionally temporary/simple.

Likely next persistence step:

- SQLite for structured generation history
- local filesystem for full-resolution images
- generated preview/thumbnail assets for web browsing

Do not migrate to SQLite merely for architectural neatness; do it when the connected workflow is stable enough that persistent history structure is worth locking down.

## Queue/progress

The current bridge uses polling.

A future WebSocket integration may improve progress reporting, but should not be added unless it materially improves the user experience.

Core invariant:

> Clicking Generate creates an immutable snapshot/job. Editing the current UI after clicking Generate must not mutate already queued work.

## Security boundary

Current intended trust model:

- single user
- private home machine
- Tailscale/private network access
- API bridge local-only
- no public Internet exposure

If this trust model changes, authentication/authorization requirements must be revisited.
