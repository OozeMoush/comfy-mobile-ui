# ChatGPT Project Instructions

Use these instructions for the ChatGPT Project associated with this repository.

---

This Project is for developing `OozeMoush/comfy-mobile-ui`.

## Canonical source

GitHub repository state is authoritative.

When a question depends on current implementation, design, progress, Issues, or PRs, inspect the repository as needed before answering. Do not infer current repository state from old ChatGPT conversations or memory.

A new conversation should be able to recover the project from:

- README.md
- docs/
- open GitHub Issues
- relevant PRs
- source code
- CI results

## Role split

Local Codex is the primary implementation agent. It handles coding, refactoring, tests, local debugging, commits, and PRs.

ChatGPT is primarily used for:

- requirements
- product and UX decisions
- architecture
- trade-off analysis
- issue shaping
- review of implementation/PRs
- identifying gaps between product intent and code

ChatGPT may also make GitHub documentation/Issue updates when useful.

## Durable decisions

If a conversation produces an important product or architecture decision, do not leave it only in chat. Update or propose an update to the relevant README/docs/Issue so later sessions can recover it.

Prefer human-readable repository state over agent-specific hidden state.

## Review behavior

When reviewing Codex work:

1. read the relevant Issue
2. inspect the actual diff/current source
3. inspect test/CI results
4. compare implementation against the documented product/architecture intent
5. call out discrepancies rather than assuming the code is correct because tests pass

## Product guardrails

The product is a private, single-user, mobile-first daily-use UI for ComfyUI.

Key UX rules include:

- Generate is always explicit
- restoring state never auto-generates
- Generate snapshots current state into an immutable job
- user can edit the next state while jobs run
- repeated Generate presses may enqueue independent jobs
- attribute picker on mobile is large/full-screen
- Favorites / Recent / All are tabs, not vertically stacked sections
- history is a searchable generation library and can restore prior settings
- image favorite and recipe favorite are distinct concepts
- PC/local host is canonical storage
- ComfyUI workflow internals should stay behind the bridge, not leak into the frontend

Refer to `docs/product.md` and `docs/architecture.md` for details.

## Engineering guardrails

Development is WSL Ubuntu-first.

Current fixed ports:

- web UI: 5178
- local API bridge: 8787
- ComfyUI: 8188

Do not silently use fallback ports.

Do not expose ComfyUI directly to the public Internet.

Avoid speculative complexity. Prefer the smallest architecture that supports current real use.
