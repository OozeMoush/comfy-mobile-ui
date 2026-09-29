# comfy-mobile-ui

Mobile-first web UI for driving a local ComfyUI setup without living in the node editor.

## Current prototype

This first pass is intentionally **interaction-first**. It lets us evaluate the workflow before wiring it to the GPU:

- fixed attribute cards with single/multi-select behavior
- full-screen attribute picker
- Favorites / Recent / All tabs
- per-attribute random and "randomize everything except Character"
- positive + attribute-level negative prompt composition
- extra one-off prompt field
- one-tap queueing; Generate can be tapped repeatedly
- simulated serial queue so the interaction can be tested without ComfyUI
- latest result controls: image favorite, recipe favorite, regenerate, restore, seed
- searchable generation history
- parent generation IDs stored on derived jobs
- dedicated preset creation screen
- global negative prompt setting
- previous working setup restored from localStorage
- PWA manifest and service-worker shell

The gradient "images" are deliberate placeholders. **No ComfyUI API is called yet.**

## Run

```bash
npm install
npm run dev
```

Vite listens on all interfaces, so the same dev server can be opened from a phone over the LAN or Tailscale once the host firewall allows it.

## Build

```bash
npm run build
npm run preview
```

## Intended architecture

```text
Phone / PC browser (this app)
        |
        | Tailscale
        v
Thin local API service
        |
        v
ComfyUI API / WebSocket
        |
        +--> full-resolution image saved on PC
        +--> smaller preview returned to the web UI
        +--> generation metadata/history database
```

The browser should not know ComfyUI workflow node IDs. The API layer will own the workflow template and translate app-level concepts such as presets, seed, queue and future LoRA controls into ComfyUI workflow JSON.

## Next implementation slice

1. Freeze the first usable Generate-screen interaction after hands-on testing.
2. Add a small local API bridge.
3. Submit a fixed ComfyUI workflow and stream job status.
4. Replace mock previews with lightweight generated previews.
5. Persist generation metadata server-side (SQLite is the likely default).
