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


## Strict workspace boundary

Treat the repository root (the current working directory when Codex is launched) as the complete project filesystem.

Do **not** inspect, enumerate, read, search, stat, glob, or otherwise probe files/directories outside the repository root.

This includes, unless the user explicitly authorizes a specific path for a specific task:

- parent directories such as `..`
- sibling repositories
- the user's home directory
- `/mnt/c` or other mounted host filesystems
- unrelated WSL directories
- global configuration files
- caches outside the repository
- directory listings intended only to discover what exists outside the repository

Do not run commands such as `ls ..`, `find ..`, `tree ..`, broad filesystem searches, or absolute-path probes outside the repository.

Do not infer or report the host filesystem layout from accidental error output or environment details.

If a task appears to require a file outside the repository, stop and explain exactly which file/path is needed and why. Do not request or obtain broader filesystem access automatically.

The only normal filesystem scope for this project is the repository itself.
