# Agent instructions

Read these before making changes:

1. README.md
2. docs/product.md
3. docs/architecture.md
4. docs/development.md
5. the relevant GitHub Issue

GitHub repository state is authoritative. Do not depend on prior ChatGPT/Codex conversation history to understand current requirements.

For implementation work:

- use the Issue as the durable work unit when one exists
- preserve documented UX/product invariants
- keep ComfyUI workflow internals behind the local bridge
- do not silently change fixed ports (5178 / 8787 / 8188)
- run the relevant type/build/tests
- leave a durable checkpoint in the Issue/PR describing what changed, what was verified, and what remains unverified
- update docs when a design/architecture rule changes

Avoid agent-only project knowledge. Keep durable decisions human-readable in README/docs/Issues.
