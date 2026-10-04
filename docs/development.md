# Development workflow

## Source of truth

The GitHub repository is the canonical project state.

A new ChatGPT session or coding agent should be able to recover the project from:

1. README
2. docs/
3. open Issues
4. recent PRs
5. source code and CI

Past ChatGPT/Codex conversation history is helpful context, but must not be required to understand the current product or implementation state.

Important decisions made in conversation should be written back to the repository.

## Responsibilities

### ChatGPT Project

Primary role:

- requirement clarification
- product/UX discussion
- architecture discussion
- critique and trade-off analysis
- issue shaping
- review of Codex implementation/PRs
- repository documentation updates when decisions change

ChatGPT should verify current repository/Issue/PR state before making claims about current implementation.

### Local Codex

Primary role:

- implementation
- refactoring
- local debugging
- tests
- build/lint/type-check
- commits and PRs
- updating the active Issue/checkpoint with implementation results

Codex should use repository state as authoritative rather than reconstructing requirements from chat history.

### Human

The user owns:

- product decisions
- hands-on UX evaluation
- local ComfyUI workflow and environment
- final judgment on trade-offs

## Work unit

Prefer an Issue as the durable work unit.

Recommended loop:

```text
Discuss requirement/design
        ↓
Create/update Issue
        ↓
Local Codex implements
        ↓
tests/build/local verification
        ↓
commit / PR
        ↓
Issue checkpoint
        ↓
ChatGPT reviews repository + Issue + PR
        ↓
merge / next decision
```

Not every tiny edit needs a new Issue. Use Issues for work that should survive session changes.

## Implementation rules

- Do not silently change product behavior without updating the relevant Issue/docs.
- Prefer small, understandable changes over speculative infrastructure.
- Do not create agent-only design state that humans cannot easily read.
- `.codex/` is not required for project knowledge.
- Keep durable guidance in README/docs/Issues.
- Root `AGENTS.md` contains concise instructions for local coding agents.
- CI should remain a mechanical backstop for build/type correctness.

## Environment

Development host assumption:

- Windows + WSL Ubuntu
- repository runs inside WSL
- PC debugging is done from a normal Windows browser
- phone testing is also required
- many other local APIs may be running concurrently

Therefore project ports are explicit and fixed:

- web 5178
- bridge 8787
- ComfyUI 8188

Avoid automatic fallback ports.

## Before implementation

Codex should:

1. read README
2. read relevant docs
3. read the target Issue
4. inspect current code
5. state/verify the success condition
6. implement

If code and Issue/docs disagree, do not guess silently. Prefer updating the Issue/checkpoint or surfacing the discrepancy.

## After implementation

Codex should record:

- what changed
- what was tested
- what remains unverified
- any product/architecture decision introduced by the implementation

If a design rule changed, update docs in the same workstream.


## Local Codex filesystem isolation

For this project, Local Codex should be launched from the repository root and should treat that directory as its entire project-visible filesystem.

Policy:

- do not read outside the repository
- do not enumerate parent/sibling/home directories
- do not inspect the layout of unrelated WSL or Windows files
- do not add external writable roots
- do not automatically request broader filesystem permissions

Repository instructions are a policy layer, not a security boundary by themselves.

For technical enforcement, use Codex with a workspace-scoped sandbox and no approval path for sandbox escape. Current Codex documentation describes `workspace-write` as the profile that operates in the current workspace, with crossing the workspace boundary requiring approval. For this project's stricter preference, use a configuration where sandbox escalation is not granted.

If the requirement is stronger — e.g. even host directory names outside the repository must not be observable — run Codex in an isolated container/VM and mount only this repository as project data. That is the strongest boundary because the outside host filesystem is not present in the agent environment at all.

Do not weaken this isolation merely to make a command convenient. If an external file is genuinely needed, the human should deliberately copy/mount the specific file into the repository or explicitly approve that one path.
