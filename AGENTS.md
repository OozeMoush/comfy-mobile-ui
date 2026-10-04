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

The only normal project-data filesystem scope for this project is the repository itself.


## Project-local Codex permissions

This repository includes `.codex/config.toml`.

For guarded Local Codex startup, run from the repository root:

```bash
node scripts/codex-local.mjs
```

The launcher checks the resolved default profile and a synthetic sandbox/proxy fixture before starting a fresh Codex process. It refuses legacy settings from any loaded configuration layer, disabled proxies, broader rules and unsupported runtimes. No special profile or command-line sandbox override is needed. A bare `codex` invocation can load the repository configuration, but bypasses this startup check and must not be presented as verified isolation.

Use `node scripts/codex-local.mjs --check` for the preflight alone. If it fails, stop and record the restriction; do not launch an unguarded session as a fallback. The fixture stays entirely inside this repository and must never probe actual outside files. See `docs/local-codex-isolation.md` for validation limits and the post-start service/browser checks.

After guarded startup, use `/debug-config`, `/permissions` and `/status` to confirm the project layer, active `comfy-local` profile, approval policy and writable roots in the actual session. Stop if these differ from the checked policy. Do not copy raw configuration or host paths into project logs. The existing `bash scripts/verify-codex-isolation.sh` entry point runs the same guard without starting an agent.

The intended local policy is:

- `approval_policy = "never"`
- `default_permissions = "comfy-local"`
- workspace files are writable through the built-in `:workspace` baseline
- reads outside the workspace are denied by default, except the Codex `:minimal` runtime paths needed to execute normal tools
- `/tmp` and TMPDIR-derived paths are denied
- command networking is enabled only through the Codex network proxy
- the only allowed command-network destinations are literal `localhost` and `127.0.0.1`
- the host allowlist permits all ports on those literals, not just 5178 / 8787 / 8188; upstream proxies and local/private hostname expansion are explicitly disabled
- no public-Internet wildcard, unrelated private-network target, extra writable root, or Unix socket is allowed

The loopback exception exists so Codex can verify the project's fixed local services:

- web UI: `5178`
- local API bridge: `8787`
- ComfyUI: `8188`

Do **not** work around a local connection failure by launching Codex with `--sandbox workspace-write`, reintroducing legacy `sandbox_mode`, setting `sandbox_workspace_write.network_access=true`, using `danger-full-access`, or adding `"*"` to the network allowlist. Those changes broaden the boundary and can disable or bypass the repository permission profile.

If an external dependency download or other non-loopback access is genuinely required, stop and state the exact destination and reason. The user can perform the install outside Codex or explicitly authorize a narrow, temporary exception. Do not broaden network access yourself.

Permission profiles and legacy `sandbox_mode` settings are alternative mechanisms and must not be combined. If the installed Codex version does not support the repository permission profile, report that incompatibility rather than silently falling back to broader access.

Separate Codex capabilities such as hosted web search, connectors, MCP servers, built-in browser/computer-use surfaces, and Codex Cloud have their own controls. Do not use them to bypass this repository's filesystem or network intent.
