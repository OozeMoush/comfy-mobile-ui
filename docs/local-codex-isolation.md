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

The development use case is access to the project's loopback services on ports 5178, 8787, and 8188. The profile's host allowlist permits **all ports** on literal `localhost` and `127.0.0.1`; it is not a three-port firewall.

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
allow_local_binding = false
allow_upstream_proxy = false

[permissions.comfy-local.network.domains]
"localhost" = "allow"
"127.0.0.1" = "allow"
```

Start Codex through the guarded launcher with the repository root as the current working directory:

```bash
node scripts/codex-local.mjs
```

The optional initial prompt must be one argument; the launcher does not forward CLI flags that could override the checked policy. It starts a fresh process using `--strict-config --no-daemon` so an older shared daemon is not silently reused.

Do not add `--sandbox workspace-write` or a legacy `sandbox_mode` override. Permission profiles and the older sandbox settings do not compose. If `sandbox_mode` remains in **any loaded configuration layer**, including a user or selected profile configuration, Codex can choose the older mechanism even though this repository removed the key. A bare `codex` command does not perform the repository's startup check. The launcher refuses a resolved config containing either legacy sandbox key and never silently falls back. It does not open global configuration files itself or print configuration contents/origins.

### Startup preflight and behavioral fixture

Run the same guard without starting an interactive agent:

```bash
node scripts/codex-local.mjs --check
```

The guard starts a local stdio app-server and uses `config/read` and `permissionProfile/list` to check the **resolved** configuration and profile availability. It requires the documented profile, `approval_policy = "never"`, an enabled proxy, the exact filesystem boundary and loopback-only allow rules. Project trust problems, unsupported APIs, unexpected options, process failures and timeouts stop the launcher. It does not start a model turn, perform credential setup, grant approval or modify global/user configuration. Raw server logs, configuration values and configuration origins are not printed or retained by the guard.

The RPC includes known unset metadata as `null`. The guard permits only the observed unset filesystem scan-depth and network metadata fields; these are not path/domain grants. Unknown fields and non-null overrides still fail validation. A sandbox executable-start failure is reported separately from a boundary/proxy test failure, and neither is treated as successful enforcement.

Next, it creates an isolated nested workspace and a sibling canary under `.cache/codex-permissions/`. Both remain inside the real repository. The fixture receives a copy of the repository config and a process-local trust override for that generated workspace only. Commands use the resolved default policy without a `permissionProfile` or `sandboxPolicy` override. They must:

- read and write the fixture's permitted file
- refuse both reading and writing its sibling canary, which simulates an outside file without accessing the actual host filesystem
- reach a synthetic loopback HTTP listener through the injected proxy
- receive a proxy rejection for a reserved `.invalid` hostname, without sending a request to a public Internet service

The fixture is removed on completion/failure. Its synthetic listener uses an ephemeral test port; it does not move or replace the application's fixed ports. All checks must pass before interactive startup. A startup failure is evidence that the guard stopped, not evidence that filesystem/network isolation was exercised successfully.

This guard checks the current configuration and a synthetic default-policy execution. It is not an administrator-enforced policy: a user can still bypass it, change configuration after checking, or launch other Codex surfaces. For stronger enforcement use managed permission requirements or the container/VM boundary below. A trusted project's configuration is also required; the guard does not automatically change trust for the real repository.

### Post-start service and browser verification

In the guarded TUI, confirm the loaded project layer and absence of legacy settings with `/debug-config`, active `comfy-local` with `/permissions`, and approval policy/writable roots with `/status`. Stop on a mismatch; retain only the policy verdict in checkpoints, not raw configuration or host paths. `bash scripts/verify-codex-isolation.sh` remains a compatibility entry point for the same preflight.

Once the guard passes in the intended WSL runtime, verify the real 5178/8787/8188 endpoints and run the actual browser checks from that guarded session. Proxy-aware clients may need explicit configuration; a successful synthetic HTTP request does not prove Node `fetch`, Playwright or Chromium connectivity. Do not disable the proxy to make a client work.

Record those results separately from the guard. The guard reports real services and browser execution as **not checked**, does not submit a GPU job, and never views generated images. Earlier Issue #1 browser results from another session/configuration are not evidence for this profile.

CI runs `node --test scripts/codex-permissions.test.mjs` using protocol doubles and adverse resolved configs. These regression checks establish guard behavior, not WSL sandbox enforcement. Before merging, record a successful real `--check` and the relevant real service/browser checks, or explicitly leave enforcement/connectivity validation pending.

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

The application's relevant endpoints are:

- `http://127.0.0.1:5178`
- `http://127.0.0.1:8787`
- `http://127.0.0.1:8188`

These are examples of intended use, not a port-level restriction. Domain rules normalize away port numbers, so adding `localhost:5178` would not create a port-specific allow rule. Unrelated loopback services are reachable under this host policy. Use a separate enforcing firewall/container boundary if restricting access to exactly three ports is required. Keep that distinction explicit in checkpoints.

`allow_local_binding = false` keeps local/private hostname expansion disabled; the exact loopback literals are the narrow exception. `allow_upstream_proxy = false` avoids sending loopback requests through an inherited upstream proxy.

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

- keep permission profiles and legacy `sandbox_mode` settings mutually exclusive across all loaded configuration layers
- retain guarded startup, post-start TUI checks and real enforcement verification after Codex/config changes
- verify that the network proxy is active whenever domain allow rules are relied upon
- preserve the loopback-only allowlist unless the repository requirements explicitly change
- preserve the repository-first privacy intent even if syntax changes
- if a profile cannot be enforced on the current WSL runtime, fail closed and report the limitation instead of falling back to broader access

See [the PR #3 follow-up checkpoint](checkpoints/pr-3-2026-10-05.md) for commands, results and remaining verification.
