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

When Codex is started from the repository root, use strict config parsing:

```bash
codex --strict-config
```

Use the repository-local permission profile automatically. Do not require a special profile or a command-line sandbox override for normal project work.

### Mandatory startup gate

Before any task that relies on this isolation boundary (especially Issue #1 browser/ComfyUI verification), confirm the effective session rather than assuming the repository config won precedence.

In the newly started Codex TUI:

1. Run `/debug-config`.
   - confirm the project `.codex/config.toml` layer is active
   - confirm no loaded config layer or selected Codex profile sets legacy `sandbox_mode` / `sandbox_workspace_write`
   - if a legacy sandbox setting is present anywhere, stop; permission profiles do not compose with it and the legacy sandbox wins
2. Run `/permissions`.
   - confirm the active named permission profile is `comfy-local`
3. Run `/status`.
   - confirm the approval policy and writable roots match the repository-local intent
4. From a normal WSL shell, run `bash scripts/verify-codex-isolation.sh`.
   - the smoke test must pass before treating the isolation policy as verified

If any check differs from the expected state, do not continue the sensitive verification and do not silently fall back to a broader sandbox. Report the mismatch so the user can correct the higher-precedence configuration outside Codex.

The intended local policy is:

- `approval_policy = "never"`
- `default_permissions = "comfy-local"`
- workspace files are writable through the built-in `:workspace` baseline
- reads outside the workspace are denied by default, except the Codex `:minimal` runtime paths needed to execute normal tools
- `/tmp` and TMPDIR-derived paths are denied
- command networking is enabled only through the Codex network proxy
- the only allowed command-network hosts are literal `localhost` and `127.0.0.1`
- this host allowlist is **not port-scoped**; other services bound to loopback ports may also be reachable
- no public-Internet wildcard, unrelated private-network target, extra writable root, or Unix socket is allowed

The loopback exception exists so Codex can verify the project's expected local services:

- web UI: `5178`
- local API bridge: `8787`
- ComfyUI: `8188`

Those three ports are application conventions, not a network-security boundary. If a task requires enforcement at the port level, use an OS firewall or a more isolated container/network namespace rather than claiming the Codex domain allowlist provides it.

Do **not** work around a local connection failure by launching Codex with `--sandbox workspace-write`, reintroducing legacy `sandbox_mode`, setting `sandbox_workspace_write.network_access=true`, using `danger-full-access`, or adding `"*"` to the network allowlist. Those changes broaden the boundary and can disable or bypass the repository permission profile.

If an external dependency download or other non-loopback access is genuinely required, stop and state the exact destination and reason. The user can perform the install outside Codex or explicitly authorize a narrow, temporary exception. Do not broaden network access yourself.

Permission profiles and legacy `sandbox_mode` settings are alternative mechanisms and must not be combined. If the installed Codex version does not support the repository permission profile, report that incompatibility rather than silently falling back to broader access.

Separate Codex capabilities such as hosted web search, connectors, MCP servers, built-in browser/computer-use surfaces, and Codex Cloud have their own controls. Do not use them to bypass this repository's filesystem or network intent.
