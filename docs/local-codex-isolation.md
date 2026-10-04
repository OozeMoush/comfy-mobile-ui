# Local Codex isolation

## Requirement

For this repository, Codex should work only with project data in the repository that it was started from.

The desired behavior is stricter than "do not modify files outside the repo":

- do not read unrelated user files
- do not list parent or sibling directories
- do not inspect the user's home layout
- do not inspect `/mnt/c` or other host mounts
- do not discover other repositories
- do not report unrelated filesystem structure
- do not grant general outbound Internet access merely to reach local ComfyUI services

The normal development exception is command-network access to the loopback hosts `localhost` and `127.0.0.1`. The application normally uses ports 5178, 8787, and 8188, but Codex domain rules are host-scoped rather than port-scoped.

## Layers of protection

### 1. Repository policy

`AGENTS.md` explicitly forbids repo-external filesystem exploration and broad network-access workarounds.

This keeps normal agent behavior aligned with the project rule, but instructions alone are not a hard security boundary.

### 2. Codex permission profile

The repository-local `.codex/config.toml` uses the current Codex permission-profile model rather than the legacy `sandbox_mode` settings.

The important shape is:

```toml
approval_policy = "never"
default_permissions = "comfy-local"

[features]
network_proxy = true

[permissions.comfy-local]
extends = ":workspace"

[permissions.comfy-local.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.comfy-local.network]
enabled = true

[permissions.comfy-local.network.domains]
"localhost" = "allow"
"127.0.0.1" = "allow"
```

Start Codex with the repository root as the current working directory and strict config parsing enabled:

```bash
codex --strict-config
```

Do not add `--sandbox workspace-write` or a legacy `sandbox_mode` override. Permission profiles and the older sandbox settings do not compose. Importantly, repository-local removal of `sandbox_mode` is not enough: if **any loaded configuration layer** (for example a user-level config or selected Codex profile) contains `sandbox_mode`, Codex uses the older sandbox mechanism instead of `default_permissions`.

### Mandatory startup verification

The repository configuration is a desired policy, not proof of the effective policy. Before relying on it:

1. launch `codex --strict-config`
2. run `/debug-config` and inspect the loaded configuration layers
   - the project `.codex/config.toml` must be active
   - no loaded layer or selected profile may contain legacy `sandbox_mode` / `sandbox_workspace_write`
3. run `/permissions`
   - the active named profile must be `comfy-local`
4. run `/status`
   - approval policy and writable roots must match the intended repository scope
5. from a normal WSL shell, run:

```bash
bash scripts/verify-codex-isolation.sh
```

Treat any mismatch or smoke-test failure as a stop condition. Correct the higher-precedence configuration outside Codex; do not weaken the repository policy to make the check pass.

The smoke test validates the permission profile itself by exercising a repository write, a blocked repo-external read, an allowed loopback request, and a blocked fixed public-web request. It deliberately does **not** claim that CI proves the effective local Codex configuration.

### Filesystem effect

The profile extends Codex's built-in `:workspace` policy so normal project files can be edited while protected workspace metadata such as `.codex/` and `.git/` retain the built-in safeguards.

The explicit filesystem rules then:

- deny general reads from the filesystem root
- allow only Codex's `:minimal` runtime paths needed for common developer tools
- deny `/tmp` and TMPDIR-derived filesystem access
- leave the repository as the only normal project-data workspace

This is materially stronger than relying on `workspace-write` plus an instruction not to look elsewhere.

It is not identical to mounting only the repository into an empty machine. The `:minimal` exception intentionally exposes a limited set of operating-system/runtime paths so commands can execute. If even that visibility is unacceptable, use the container/VM boundary described below.

### Network effect

The profile enables command networking because Issue #1 verification needs Codex-run commands to communicate with the locally running application and ComfyUI.

Network access is paired with the Codex network proxy and an allowlist containing only:

- `localhost`
- `127.0.0.1`

This is intended to permit the application's usual loopback endpoints:

- `http://127.0.0.1:5178`
- `http://127.0.0.1:8787`
- `http://127.0.0.1:8188`

However, the allowlist is by **host/IP, not by port**. Allowing `127.0.0.1` or `localhost` can make other ports on those loopback hosts reachable to sandboxed commands as well. The fixed ports above are therefore application conventions, not a security boundary.

This trade-off is accepted for the current local WSL development workflow. If loopback access must be restricted to specific ports, enforce that at a lower layer such as an OS firewall, network namespace, container, or VM.

Public Internet destinations and unrelated LAN/private-network destinations are not allowlisted. Do not replace this with `sandbox_workspace_write.network_access=true` without a proxy allowlist, because command networking enabled without an active enforcing proxy is broad direct outbound access.

Do not add a global `"*"` allow rule for routine development.

If package installation needs npm/GitHub access, prefer one of these:

1. have the user perform the specific install in a normal terminal, or
2. explicitly authorize only the required destination for that task and remove the exception afterward.

Do not broaden the permanent project policy merely to make dependency installation convenient.

The command-network policy is not a global control for every Codex capability. Hosted web search, connectors, MCP servers, built-in browser/computer-use surfaces, and Codex Cloud use separate controls. They must not be used as a bypass for the project's isolation intent.

## Why the previous one-off command is not the default

A command such as:

```bash
codex --no-daemon --sandbox workspace-write \
  -c 'sandbox_workspace_write.network_access=true'
```

solves the immediate loopback-connectivity problem, but it is deliberately broader than this project needs:

- the legacy `--sandbox` selection prevents the permission profile from being the active isolation mechanism
- `network_access=true` without an enforcing allowlist permits general command-network access, not only localhost
- `workspace-write` is primarily a write boundary and does not express the desired deny-by-default filesystem-read policy

Therefore it should not be the normal verification path for this repository.

## Strongest isolation

If "Codex must not even be able to observe host names/layout outside this repository and the minimal runtime surface" is a hard privacy requirement, use an isolated container or VM.

Recommended shape:

```text
WSL host
├── many private files / other repositories     <- not mounted
└── container / isolated environment
    └── /workspace
        └── comfy-mobile-ui                      <- only project data exposed
```

Mount only the repository into the isolated environment. Do not mount the WSL home directory, `/mnt/c`, Docker socket, SSH directory, credential stores, or unrelated caches.

Codex will still see normal files that belong to the container operating system/runtime, but it cannot inspect the host's unrelated filesystem because those paths are not mounted.

## External inputs

When Codex genuinely needs an outside file:

1. copy the specific file into a repository-local temporary/input directory, or
2. explicitly mount/authorize that one file/path for the task.

Do not grant broad home-directory or parent-directory access as a shortcut.

For external network access, use the same principle: authorize the narrowest destination needed for the specific task rather than enabling unrestricted Internet access.

## Compatibility and maintenance

Codex permission profiles are currently a beta feature and may evolve.

The authoritative behavior is the current OpenAI permission documentation:

- https://learn.chatgpt.com/docs/permissions
- https://learn.chatgpt.com/docs/agent-approvals-security

When updating Codex or this configuration:

- keep permission profiles and legacy `sandbox_mode` settings mutually exclusive across **all loaded configuration layers**, not only this repository
- use `--strict-config`, `/debug-config`, `/permissions`, and `/status` as the startup gate before sensitive verification
- run `scripts/verify-codex-isolation.sh` locally after Codex/config changes; CI build success is not evidence that the local isolation policy is enforced
- verify network-proxy enforcement behavior whenever domain allow rules are relied upon
- preserve the loopback-host-only allowlist unless the repository requirements explicitly change, and remember that it is not port-scoped
- preserve the repository-first privacy intent even if syntax changes
- if a profile cannot be enforced on the current WSL runtime, fail closed and report the limitation instead of falling back to broader access
