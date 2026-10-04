#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

command -v git >/dev/null 2>&1 || fail "git is required"
command -v codex >/dev/null 2>&1 || fail "codex is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run this from inside the repository"
cd "$repo_root"

case "$(uname -s)" in
  Linux) ;;
  *) fail "this smoke test currently targets the project's WSL/Linux environment" ;;
esac

work_dir="$repo_root/.codex-policy-smoke.$$"
outside_canary="/tmp/comfy-mobile-ui-codex-policy-$$"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
  rm -f "$outside_canary"
}
trap cleanup EXIT INT TERM

mkdir -p "$work_dir"
printf 'harmless outside-workspace canary\n' > "$outside_canary"

sandbox() {
  codex --strict-config sandbox linux \
    -C "$repo_root" \
    --permission-profile comfy-local \
    -- "$@"
}

# Profile resolution + repository write.
sandbox sh -c 'printf "workspace write ok\n" > "$1"' sh "$work_dir/workspace-write.txt" \
  >/dev/null 2>&1 || fail "comfy-local could not write inside the repository"
[[ -s "$work_dir/workspace-write.txt" ]] || fail "repository write did not produce the expected file"
pass "repository write is allowed"

# Do not disclose the parent listing even if a broken policy unexpectedly permits it.
if sandbox sh -c 'ls .. >/dev/null 2>&1'; then
  fail "repo-external parent directory was readable"
fi
pass "repo-external parent directory listing is denied"

if sandbox sh -c 'cat "$1" >/dev/null 2>&1' sh "$outside_canary"; then
  fail "/tmp outside-workspace canary was readable"
fi
pass "/tmp outside-workspace read is denied"

# Start a harmless loopback server on an arbitrary port. Success here also
# demonstrates the documented limitation: the allowlist is host-scoped, not
# restricted to 5178/8787/8188.
port_file="$work_dir/loopback-port"
python3 - "$port_file" <<'PY' &
import http.server
import socketserver
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        pass

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        f.write(str(server.server_address[1]))
        f.flush()
    server.serve_forever()
PY
server_pid=$!

for _ in $(seq 1 50); do
  [[ -s "$port_file" ]] && break
  sleep 0.05
done
[[ -s "$port_file" ]] || fail "could not start loopback canary server"
loopback_port="$(cat "$port_file")"

sandbox env LOOPBACK_PORT="$loopback_port" python3 -c 'import os, urllib.request; urllib.request.urlopen("http://127.0.0.1:" + os.environ["LOOPBACK_PORT"] + "/", timeout=3).read()' \
  >/dev/null 2>&1 || fail "allowlisted loopback request was blocked"
pass "loopback host access is allowed (arbitrary test port $loopback_port; host rule is not port-scoped)"

# Fixed public destination; no project/user data is included. If this succeeds,
# the proxy/domain restriction is not enforcing the intended policy.
if sandbox python3 -c 'import urllib.request; urllib.request.urlopen("https://example.com/", timeout=5).read(1)' \
  >/dev/null 2>&1; then
  fail "public Internet request unexpectedly succeeded"
fi
pass "public Internet request is denied"

printf '\nIsolation smoke test passed.\n'
printf 'This validates the comfy-local profile behavior, not which profile an already-running TUI selected.\n'
printf 'Before sensitive work, also verify the live session with /debug-config, /permissions, and /status.\n'
