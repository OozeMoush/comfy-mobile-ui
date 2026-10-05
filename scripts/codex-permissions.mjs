import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { copyRepositoryRuntime, repositoryRuntime } from "./codex-runtime.mjs";

function requirePolicy(condition, message) {
  if (!condition) throw new Error(message);
}

// Inspect only permission fields from the resolved config. Never print config,
// configuration origins, stderr, environment values, or server error messages.
export function validateConfig(config, profiles) {
  requirePolicy(config && typeof config === "object", "Effective configuration unavailable.");
  requirePolicy(config.sandbox_mode == null && config.sandbox_workspace_write == null,
    "Legacy sandbox settings are loaded; comfy-local cannot be trusted as the active policy.");
  requirePolicy(config.default_permissions === "comfy-local", "comfy-local is not the configured default.");
  requirePolicy(config.approval_policy === "never", "Approval policy must be never.");
  requirePolicy(config.features?.network_proxy === true, "The network proxy feature is not enabled.");
  requirePolicy(profiles.some(item => item.id === "comfy-local" && item.allowed === true),
    "The runtime does not allow the comfy-local profile.");
  const profile = config.permissions?.["comfy-local"];
  requirePolicy(profile?.extends === ":workspace", "comfy-local must extend the protected :workspace baseline.");
  requirePolicy(!Object.values(profile.workspace_roots ?? {}).some(value => value !== false),
    "Additional profile workspace roots are not permitted.");
  const expected = { ":root": "deny", ":minimal": "read", ":tmpdir": "deny", ":slash_tmp": "deny" };
  const files = profile.filesystem;
  // config/read serializes known unset options as null. They are metadata,
  // not extra path grants; unknown fields and non-null overrides still fail.
  const fileKeys = Object.keys(files ?? {}).filter(key => !(key === "glob_scan_max_depth" && files[key] == null));
  requirePolicy(files && fileKeys.length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => files[key] === value),
  "Filesystem rules differ from the repository boundary.");
  const network = profile.network;
  requirePolicy(network?.enabled === true, "Profile networking is not enabled.");
  requirePolicy(network.allow_local_binding === false && network.allow_upstream_proxy === false,
    "Local/private-network expansion and upstream proxies must be explicitly disabled.");
  const known = ["enabled", "domains", "allow_local_binding", "allow_upstream_proxy", "unix_sockets",
    "dangerously_allow_all_unix_sockets", "dangerously_allow_non_loopback_proxy"];
  const unsetOptions = ["proxy_url", "enable_socks5", "socks_url", "enable_socks5_udp", "mode", "mitm"];
  requirePolicy(Object.keys(network).every(key => known.includes(key) ||
    (unsetOptions.includes(key) && network[key] == null)), "Unexpected network overrides require review.");
  requirePolicy(!network.dangerously_allow_all_unix_sockets && !network.dangerously_allow_non_loopback_proxy &&
    !Object.values(network.unix_sockets ?? {}).some(value => value !== "deny"), "Network escape hatches are not permitted.");
  const domains = network.domains ?? {};
  const allowed = Object.entries(domains).filter(([, rule]) => rule === "allow").map(([host]) => host).sort();
  requirePolicy(allowed.join(",") === "127.0.0.1,localhost" &&
    Object.values(domains).every(rule => rule === "allow" || rule === "deny"),
  "Only literal localhost and 127.0.0.1 may be allowlisted (all ports).");
}

export function startServer(cwd, { spawnImpl = spawn, timeoutMs = 20_000, args = [], executable = "codex" } = {}) {
  const child = spawnImpl(executable, ["app-server", "--stdio", "--strict-config", ...args], {
    cwd, stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let dead = false;
  const pending = new Map();
  const rejectAll = () => {
    dead = true;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("Codex app-server stopped; check runtime/trust prerequisites. No agent was started."));
    }
    pending.clear();
  };
  // Drain without retaining potentially private runtime logs.
  child.stderr.on("data", () => {});
  child.on("error", rejectAll);
  child.on("exit", rejectAll);
  child.stdin.on("error", rejectAll);
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { rejectAll(); child.kill(); return; }
    if (message.method && message.id !== undefined) {
      // Never approve server-initiated requests during the preflight.
      rejectAll(); child.kill(); return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method} failed; permission support could not be verified.`));
    else request.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (dead) { reject(new Error("Codex app-server is unavailable.")); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out; verification is incomplete.`));
      child.kill();
    }, timeoutMs);
    pending.set(id, { method, resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  return {
    rpc,
    async initialize() {
      await rpc("initialize", { clientInfo: { name: "comfy_permission_preflight", version: "1.0" },
        capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    },
    async close() {
      lines.close();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.kill("SIGTERM");
      });
    },
  };
}

export async function readPolicy(server, cwd) {
  await server.initialize();
  const { config } = await server.rpc("config/read", { cwd, includeLayers: false });
  const profiles = [];
  const seen = new Set();
  let cursor;
  do {
    const result = await server.rpc("permissionProfile/list", { cwd, ...(cursor ? { cursor } : {}) });
    requirePolicy(Array.isArray(result?.data), "Permission profile discovery is unsupported.");
    profiles.push(...result.data);
    requirePolicy(!result.nextCursor || !seen.has(result.nextCursor), "Permission profile pagination did not advance.");
    if (result.nextCursor) seen.add(result.nextCursor);
    cursor = result.nextCursor;
  } while (cursor);
  validateConfig(config, profiles);
}

// Child code touches only deliberately created fixture paths. HTTP goes through
// the injected proxy; a reserved .invalid hostname tests rejection without any
// request to a public Internet service. ENOENT is valid for namespace isolation.
export const probeSource = String.raw`
const fs = require("node:fs");
const http = require("node:http");
const assert = require("node:assert/strict");
const [allowed, denied, target] = process.argv.slice(1);
const proxyText = process.env.HTTP_PROXY ?? process.env.http_proxy;
assert.ok(proxyText, "proxy environment missing");
const proxy = new URL(proxyText);
assert.ok(["127.0.0.1", "localhost"].includes(proxy.hostname), "proxy is not loopback");
assert.equal(proxy.protocol, "http:");
assert.equal(fs.readFileSync(allowed, "utf8"), "fixture");
fs.writeFileSync(allowed, "updated");
for (const operation of [() => fs.readFileSync(denied), () => fs.writeFileSync(denied, "unexpected")]) {
  let refused = false;
  try { operation(); } catch (error) { refused = ["EACCES", "EPERM", "ENOENT", "EROFS"].includes(error.code); }
  assert.ok(refused, "outside fixture access was permitted");
}
function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(proxy, { path: url, method: "GET", headers: { host: new URL(url).host } }, res => {
      let body = ""; res.on("data", data => { body += data; });
      res.on("end", () => resolve({status:res.statusCode, body}));
    });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.on("error", reject); req.end();
  });
}
(async () => {
  const ok = await request(target);
  assert.equal(ok.status, 200); assert.equal(ok.body, "fixture-network");
  const deniedResponse = await request("http://codex-preflight-denied.invalid/");
  assert.equal(deniedResponse.status, 403, "non-allowlisted host not rejected by proxy");
  console.log("fixture-policy-passed");
})().catch(() => process.exit(1));
`;

export async function checkPermissions(cwd, { serverFactory = startServer } = {}) {
  // Use resolved settings, not the repository TOML alone, to detect inherited
  // legacy settings, an untrusted project, widened rules or a disabled proxy.
  const runtime = await repositoryRuntime(cwd);
  const server = serverFactory(cwd, runtime ? { executable: runtime.codex } : undefined);
  try { await readPolicy(server, cwd); } finally { await server.close(); }

  // An isolated nested git root simulates an outside file while every file is
  // still inside the real repository. Never probe the actual host filesystem.
  const cache = path.join(cwd, ".cache", "codex-permissions");
  await fs.mkdir(cache, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(cache, "run-"));
  const workspace = path.join(fixture, "workspace");
  const denied = path.join(fixture, "outside-canary.txt");
  let fixtureServer;
  let service;
  try {
    await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fs.mkdir(path.join(workspace, ".codex"));
    await fs.writeFile(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/fixture\n");
    await fs.mkdir(path.join(workspace, ".git", "objects"));
    await fs.mkdir(path.join(workspace, ".git", "refs"));
    await fs.copyFile(path.join(cwd, ".codex", "config.toml"), path.join(workspace, ".codex", "config.toml"));
    const fixtureRuntime = runtime ? await copyRepositoryRuntime(runtime, workspace) : null;
    const allowed = path.join(workspace, "inside.txt");
    await fs.writeFile(allowed, "fixture");
    await fs.writeFile(denied, "canary");
    service = http.createServer((req, res) => { res.writeHead(200); res.end("fixture-network"); });
    await new Promise((resolve, reject) => { service.once("error", reject); service.listen(0, "127.0.0.1", resolve); });
    const target = `http://127.0.0.1:${service.address().port}/`;
    // Trust only this generated fixture via a process-local override, without
    // changing user/global files or overriding permissions/sandbox settings.
    fixtureServer = serverFactory(workspace, { args: ["-c", `projects={ ${JSON.stringify(workspace)} = { trust_level="trusted" } }`],
      ...(fixtureRuntime ? { executable: fixtureRuntime.codex } : {}) });
    await readPolicy(fixtureServer, workspace);
    const result = await fixtureServer.rpc("command/exec", { cwd: workspace,
      command: [fixtureRuntime?.node ?? process.execPath, "-e", probeSource, allowed, denied, target], timeoutMs: 15_000 });
    requirePolicy(!(result?.exitCode !== 0 && /bwrap: execvp[^\n]*No such file or directory/.test(result?.stderr ?? "")),
      "Behavioral sandbox/proxy checks failed: sandbox runtime re-execution could not start. Repository-local Codex/Node executables may be needed; no host files will be copied automatically and no agent will be started.");
    requirePolicy(result?.exitCode === 0 && result.stdout?.trim() === "fixture-policy-passed",
      "Behavioral sandbox/proxy checks failed; no agent will be started.");
    requirePolicy(await fs.readFile(allowed, "utf8") === "updated" && await fs.readFile(denied, "utf8") === "canary",
      "Fixture write boundary was not preserved.");
    return { configuration: true, fixtureBoundary: true, proxyAllowAndDeny: true,
      liveServices: "not checked", browser: "not checked" };
  } finally {
    await fixtureServer?.close();
    if (service) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
    await fs.rm(fixture, { recursive: true, force: true });
  }
}
