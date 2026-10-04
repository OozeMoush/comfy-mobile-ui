# Local Codex isolation

## Requirement

For this repository, Codex should work only with files in the repository that it was started from.

The desired behavior is stricter than "do not modify files outside the repo":

- do not read unrelated files
- do not list parent or sibling directories
- do not inspect the user's home layout
- do not inspect `/mnt/c` or other host mounts
- do not discover other repositories
- do not report unrelated filesystem structure

## Two layers

### 1. Repository policy

`AGENTS.md` explicitly forbids repo-external filesystem exploration.

This keeps normal agent behavior aligned with the project rule, but instructions alone are not a hard security boundary.

### 2. Codex sandbox

Use a workspace-scoped Codex sandbox.

A suitable user-level/profile configuration is conceptually:

```toml
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
exclude_tmpdir_env_var = true
exclude_slash_tmp = true
```

Do not add `writable_roots` for unrelated directories.

Start Codex with the repository root as the current working directory.

With this setup, the intended filesystem boundary is the current workspace and Codex has no interactive approval path to escape the sandbox.

## Strongest isolation

If "Codex must not even be able to observe names/layout outside this repository" is a hard privacy requirement, use an isolated container or VM.

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
