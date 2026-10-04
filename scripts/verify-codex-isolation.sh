#!/usr/bin/env bash
set -euo pipefail

# Keep the existing smoke-test entry point; all fixtures stay in the repository.
# The guard checks the resolved default policy instead of forcing a profile.
exec node scripts/codex-local.mjs --check
