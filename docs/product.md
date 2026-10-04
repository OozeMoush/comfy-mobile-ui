# Product

## Goal

Build a private, mobile-first image generation UI that makes everyday ComfyUI use much faster from both a PC browser and a phone.

The product is not primarily a free-form prompt editor. It is a **stateful generation UI** where the user starts from a usable recipe, changes only the attributes that matter, generates, and branches from good results.

## Primary usage

- PC is nearby, but opening and operating detailed ComfyUI nodes is unnecessary friction.
- Phone use from a couch/bed while repeatedly generating and reviewing images.
- Remote use over Tailscale to the home GPU.
- PC browser remains a first-class debugging and daily-use surface.

## Core interaction

The Generate screen is the center of the product.

Generation state is composed from fixed attribute categories:

- Character
- Outfit
- Body
- Pose
- Camera
- Expression
- Scene
- Lighting
- Style

Category order is not a product invariant and may change as the UI evolves.

Categories may be single-select or multi-select. Current examples:

- Character: single
- Outfit: multi
- Body: multi

Each preset contributes:

- positive prompt text
- optional negative prompt text

Prompt composition uses a stable category order. Semantic contradiction detection is intentionally out of scope.

A global negative prompt is combined with negative text contributed by selected presets.

An Extra Prompt field handles one-off details that do not deserve a reusable preset.

## Attribute picker

Selecting an attribute opens a large/full-screen picker on mobile.

The picker does **not** stack Favorites, Recent, and All vertically. These are switchable tabs:

- Favorites
- Recent
- All

Search is available across the current picker view.

Randomization is a first-class action:

- randomize one attribute
- randomize broader state while preserving Character

## Generate semantics

Generate is always explicit.

Pressing Generate:

1. snapshots the current state
2. creates an independent job
3. immediately returns the UI to an editable state

The user can change settings while previous work is queued/running.

Repeated Generate presses enqueue multiple independent jobs.

Restoring a prior setup must never auto-generate.

Normal Generate uses a new random seed. Seed reuse/lock is a separate intentional action.

## Results and history

The Generate screen should show the latest result directly.

History is a searchable generation library, not just a list of PNG files.

A generation record should retain enough metadata to reproduce/derive from it:

- positive prompt
- negative prompt
- seed
- model/workflow identity
- generation parameters
- timestamp
- selected attribute snapshot
- parent generation ID when derived from another result

History items can restore their settings back into the Generate screen.

Two favorites are conceptually distinct:

- image favorite: this output is good
- recipe favorite: this generation configuration is useful and reusable

Parent generation IDs are stored even if branch visualization is not yet exposed.

## Persistence

The PC/home host is the canonical storage location.

Phone auto-save is not required. Explicit download/save may be added later.

Full-resolution images stay on the PC. The web UI should prefer lightweight previews/thumbnails for browsing to avoid unnecessary transfer and memory usage.

## Current scope

Current product assumptions:

- private single-user application
- one model/workflow exposed in the UI for now
- no LoRA UI in the MVP
- no semantic prompt conflict resolver
- no multi-user authentication system
- Tailscale/private network is the intended remote access path

ComfyUI remains available for workflow editing and experiments. This app is intended to become the daily-use generation surface.

## MVP success criterion

Without opening the ComfyUI UI, the user can:

1. open the app from PC or phone
2. choose/modify attribute presets
3. generate one image
4. view the result
5. regenerate or modify a small part and branch
6. find the result later in history
7. restore its settings
8. keep canonical output/history on the PC
