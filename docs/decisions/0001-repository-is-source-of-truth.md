# ADR 0001: Repository is the source of truth

Status: Accepted

## Context

This project is developed through multiple interfaces:

- ChatGPT web Project for product/design discussion
- Local Codex for rapid implementation
- GitHub for code, Issues, PRs and CI

If important state lives only in one chat session, future sessions and agents cannot reliably recover why the code looks the way it does.

## Decision

The GitHub repository is the canonical durable project state.

Product intent, architecture, implementation state, and active work should be recoverable from README/docs/Issues/PRs/source code without requiring previous chat history.

ChatGPT and Codex may use conversation context to work faster, but important new decisions must land back in GitHub.

## Consequences

Positive:

- session-independent recovery
- ChatGPT and Codex can share the same durable state
- less reliance on memory
- easier review of implementation against intent

Trade-off:

- important decisions require lightweight documentation/checkpoint discipline

This trade-off is accepted.
