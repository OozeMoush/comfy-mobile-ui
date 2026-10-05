import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { checkPermissions, readPolicy, startServer, validateConfig } from "./codex-permissions.mjs";
import { copyRepositoryRuntime, repositoryRuntime } from "./codex-runtime.mjs";

const profiles = [{ id: "comfy-local", allowed: true }];
const good = () => ({
  approval_policy: "never", default_permissions: "comfy-local", features: { network_proxy: true },
  permissions: { "comfy-local": {
    extends: ":workspace", filesystem: { ":root": "deny", ":minimal": "read", ":tmpdir": "deny", ":slash_tmp": "deny" },
    network: { enabled: true, allow_local_binding: false, allow_upstream_proxy: false,
      domains: { localhost: "allow", "127.0.0.1": "allow" } },
  } },
});

test("the intended resolved policy is accepted", () => assert.doesNotThrow(() => validateConfig(good(), profiles)));

// Shape observed from Codex 0.160.0 config/read; deliberately contains only
// this repository's policy fields, without host paths or runtime config.
const serializedGood = () => {
  const config = good();
  config.permissions["comfy-local"].filesystem.glob_scan_max_depth = null;
  Object.assign(config.permissions["comfy-local"].network, {
    proxy_url: null, enable_socks5: null, socks_url: null, enable_socks5_udp: null,
    dangerously_allow_non_loopback_proxy: null, dangerously_allow_all_unix_sockets: null,
    mode: null, mitm: null, unix_sockets: null,
  });
  return config;
};
test("accepts the real RPC shape with known unset metadata", () => {
  assert.doesNotThrow(() => validateConfig(serializedGood(), profiles));
});
test("reads a serialized policy through the RPC before validation", async () => {
  const server = {
    async initialize() {},
    async rpc(method) {
      return method === "config/read" ? { config: serializedGood() } : { data: profiles };
    },
  };
  await readPolicy(server, "/fixture");
});
for (const [field, value] of Object.entries({ proxy_url: "http://example.invalid:3128", enable_socks5: true,
  socks_url: "http://example.invalid:8081", enable_socks5_udp: true, mode: "limited", mitm: {} })) {
  test(`refuses non-null override for serialized ${field}`, () => {
    const config = serializedGood(); config.permissions["comfy-local"].network[field] = value;
    assert.throws(() => validateConfig(config, profiles), /Unexpected network overrides/);
  });
}
test("does not ignore unknown null fields or path grants", () => {
  for (const location of ["filesystem", "network"]) {
    const config = serializedGood(); config.permissions["comfy-local"][location].unreviewed = null;
    assert.throws(() => validateConfig(config, profiles));
  }
  const config = serializedGood(); config.permissions["comfy-local"].filesystem["/fake/private"] = null;
  assert.throws(() => validateConfig(config, profiles), /Filesystem rules differ/);
});
test("does not ignore non-null filesystem metadata", () => {
  const config = serializedGood(); config.permissions["comfy-local"].filesystem.glob_scan_max_depth = 3;
  assert.throws(() => validateConfig(config, profiles), /Filesystem rules differ/);
});

const cases = [
  ["legacy mode inherited from another config layer", c => { c.sandbox_mode = "workspace-write"; }],
  ["legacy options table", c => { c.sandbox_workspace_write = { network_access: true }; }],
  ["project config ignored or default changed", c => { delete c.default_permissions; }],
  ["approval escape", c => { c.approval_policy = "on-request"; }],
  ["proxy disabled", c => { c.features.network_proxy = false; }],
  ["broad profile inheritance", c => { c.permissions["comfy-local"].extends = ":danger-full-access"; }],
  ["extra workspace root", c => { c.permissions["comfy-local"].workspace_roots = { "/fake/private": true }; }],
  ["general filesystem reads", c => { c.permissions["comfy-local"].filesystem[":root"] = "read"; }],
  ["additional readable subtree", c => { c.permissions["comfy-local"].filesystem["/fake/private"] = "read"; }],
  ["temp escape", c => { c.permissions["comfy-local"].filesystem[":tmpdir"] = "write"; }],
  ["profile network off", c => { c.permissions["comfy-local"].network.enabled = false; }],
  ["private network guard disabled", c => { c.permissions["comfy-local"].network.allow_local_binding = true; }],
  ["upstream proxy", c => { c.permissions["comfy-local"].network.allow_upstream_proxy = true; }],
  ["public wildcard", c => { c.permissions["comfy-local"].network.domains["*"] = "allow"; }],
  ["extra Internet destination", c => { c.permissions["comfy-local"].network.domains["example.invalid"] = "allow"; }],
  ["port rule mistaken for a port restriction", c => { c.permissions["comfy-local"].network.domains["localhost:5178"] = "allow"; }],
  ["Unix socket", c => { c.permissions["comfy-local"].network.unix_sockets = { "/fake/socket": "allow" }; }],
  ["all Unix sockets", c => { c.permissions["comfy-local"].network.dangerously_allow_all_unix_sockets = true; }],
  ["nonlocal proxy bind", c => { c.permissions["comfy-local"].network.dangerously_allow_non_loopback_proxy = true; }],
  ["unreviewed network option", c => { c.permissions["comfy-local"].network.new_option = true; }],
];
for (const [name, change] of cases) test(`refuses ${name}`, () => {
  const config = good(); change(config); assert.throws(() => validateConfig(config, profiles));
});
test("managed requirements can reject the profile", () => assert.throws(() => validateConfig(good(), [{ id: "comfy-local", allowed: false }])));

// Protocol double: exercises handshaking, default-policy inspection, failures
// and cleanup without launching Codex or reading any host configuration.
function fakeChild(respond) {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  child.kill = signal => { child.signalCode = signal; child.emit("exit", null); return true; };
  let buffer = "";
  child.stdin.on("data", data => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      if (request.id !== undefined) queueMicrotask(() => {
        const response = respond(request, child);
        if (response) child.stdout.write(JSON.stringify({ id: request.id, ...response }) + "\n");
      });
    }
  });
  return child;
}

test("uses resolved default config with no permission override, paginates profiles and closes the server", async () => {
  const requests = [];
  let child;
  const server = startServer("/fixture", { spawnImpl: (command, args, options) => {
    assert.equal(command, "codex"); assert.deepEqual(args, ["app-server", "--stdio", "--strict-config"]);
    assert.equal(options.cwd, "/fixture");
    child = fakeChild(request => {
      requests.push(request);
      if (request.method === "initialize") return { result: {} };
      if (request.method === "config/read") return { result: { config: good() } };
      if (!request.params.cursor) return { result: { data: [], nextCursor: "next" } };
      return { result: { data: profiles, nextCursor: null } };
    }); return child;
  } });
  try { await readPolicy(server, "/fixture"); } finally { await server.close(); }
  assert.deepEqual(requests.find(r => r.method === "config/read").params, { cwd: "/fixture", includeLayers: false });
  assert.equal(child.signalCode, "SIGTERM");
});

test("bootstrap failure stops preflight without disclosing host stderr", async () => {
  const server = startServer("/fixture", { spawnImpl: () => fakeChild((request, child) => {
    child.stderr.write("private runtime path and secret should not be forwarded");
    child.exitCode = 1; child.emit("exit", 1);
  }) });
  try { await assert.rejects(readPolicy(server, "/fixture"), /No agent was started/); } finally { await server.close(); }
});

test("unsupported RPC fails without disclosing server error text", async () => {
  const server = startServer("/fixture", { spawnImpl: () => fakeChild(() => ({ error: { code: -32601, message: "private settings" } })) });
  try { await assert.rejects(readPolicy(server, "/fixture"), /permission support could not be verified/); } finally { await server.close(); }
});

test("no response times out rather than continuing", async () => {
  const server = startServer("/fixture", { timeoutMs: 10, spawnImpl: () => fakeChild(() => undefined) });
  try { await assert.rejects(readPolicy(server, "/fixture"), /timed out/); } finally { await server.close(); }
});

test("preflight rejects unsolicited approval requests", async () => {
  const server = startServer("/fixture", { spawnImpl: () => fakeChild((request, child) => {
    child.stdout.write(JSON.stringify({ id: "approval", method: "item/permissions/requestApproval", params: {} }) + "\n");
  }) });
  try { await assert.rejects(readPolicy(server, "/fixture"), /No agent was started/); } finally { await server.close(); }
});

for (const behavior of ["passed", "local-runtime", "sandbox-failed", "sandbox-unavailable", "canary-mutated"]) {
  test(`fixture ${behavior}: default policy, repository-contained paths and cleanup`, async () => {
    const cache = path.join(process.cwd(), ".cache", "guard-tests");
    await fs.mkdir(cache, { recursive: true });
    const root = await fs.mkdtemp(path.join(cache, "run-"));
    await fs.mkdir(path.join(root, ".codex"));
    await fs.writeFile(path.join(root, ".codex", "config.toml"), "# synthetic fixture\n");
    if (behavior === "local-runtime") {
      await fs.mkdir(path.join(root, ".codex", "runtime"));
      for (const name of ["codex", "node"]) await fs.writeFile(path.join(root, ".codex", "runtime", name), name, { mode: 0o755 });
    }
    const calls = [];
    let closed = 0;
    let fixturePath;
    const serverFactory = (cwd, options) => ({
      async initialize() {},
      async close() { closed++; },
      async rpc(method, params) {
        calls.push(method);
        if (method === "config/read") {
          if (behavior === "local-runtime") assert.equal(options.executable, path.join(cwd, ".codex", "runtime", "codex"));
          return { config: good() };
        }
        if (method === "permissionProfile/list") return { data: profiles };
        assert.equal(method, "command/exec");
        assert.equal(params.permissionProfile, undefined);
        assert.equal(params.sandboxPolicy, undefined);
        assert.equal(params.cwd, cwd);
        fixturePath = path.dirname(cwd);
        for (const file of params.command.slice(3, 5)) {
          const relative = path.relative(root, file);
          assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
        }
        assert.equal(options.args[0], "-c");
        assert.ok(options.args[1].startsWith("projects="));
        if (behavior === "local-runtime") {
          assert.equal(params.command[0], path.join(cwd, ".codex", "runtime", "node"));
          assert.equal(await fs.readFile(options.executable, "utf8"), "codex");
          assert.equal(await fs.readFile(params.command[0], "utf8"), "node");
        }
        const [inside, canary] = params.command.slice(3, 5);
        await fs.writeFile(inside, "updated");
        if (behavior === "canary-mutated") await fs.writeFile(canary, "unexpected");
        return { exitCode: behavior.startsWith("sandbox-") ? 1 : 0, stdout: "fixture-policy-passed\n",
          stderr: behavior === "sandbox-unavailable" ? "bwrap: execvp /fake/private-executable: No such file or directory\n" : "" };
      },
    });
    try {
      if (behavior === "passed" || behavior === "local-runtime") {
        const result = await checkPermissions(root, { serverFactory });
        assert.equal(result.liveServices, "not checked");
        assert.equal(result.browser, "not checked");
      } else await assert.rejects(checkPermissions(root, { serverFactory }), error => {
        assert.match(error.message, /checks failed|boundary was not preserved/);
        if (behavior === "sandbox-unavailable") {
          assert.match(error.message, /sandbox runtime re-execution could not start/);
          assert.ok(!error.message.includes("/fake/private-executable"));
        }
        return true;
      });
      assert.equal(closed, 2);
      assert.equal(calls.filter(method => method === "command/exec").length, 1);
      await assert.rejects(fs.access(fixturePath), { code: "ENOENT" });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test("configuration refusal stops before fixture execution", async () => {
  const cache = path.join(process.cwd(), ".cache", "guard-tests");
  await fs.mkdir(cache, { recursive: true });
  const root = await fs.mkdtemp(path.join(cache, "refused-"));
  let closed = false;
  try {
  await assert.rejects(checkPermissions(root, { serverFactory: () => ({
    async initialize() {}, async close() { closed = true; },
    async rpc(method) {
      if (method === "config/read") return { config: { ...good(), sandbox_mode: "workspace-write" } };
      assert.equal(method, "permissionProfile/list"); return { data: profiles };
    },
  }) }), /Legacy sandbox/);
  assert.equal(closed, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

for (const variant of ["absent", "valid", "partial", "directory-symlink", "file-symlink", "not-executable"]) {
  test(`repository runtime ${variant}: fixed local paths only`, async () => {
    const cache = path.join(process.cwd(), ".cache", "runtime-tests");
    await fs.mkdir(cache, { recursive: true });
    const root = await fs.mkdtemp(path.join(cache, "run-"));
    try {
      await fs.mkdir(path.join(root, ".codex"));
      if (variant === "absent") { assert.equal(await repositoryRuntime(root), null); return; }
      const directory = path.join(root, ".codex", "runtime");
      if (variant === "directory-symlink") {
        await fs.mkdir(path.join(root, "target"));
        await fs.symlink(path.join(root, "target"), directory);
      } else {
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, "codex"), "codex", { mode: variant === "not-executable" ? 0o644 : 0o755 });
        if (variant !== "partial") await fs.writeFile(path.join(directory, "node"), "node", { mode: 0o755 });
        if (variant === "file-symlink") {
          await fs.unlink(path.join(directory, "codex"));
          await fs.symlink(path.join(directory, "node"), path.join(directory, "codex"));
        }
      }
      if (variant !== "valid") { await assert.rejects(repositoryRuntime(root), /Repository runtime/); return; }
      const runtime = await repositoryRuntime(root);
      const workspace = path.join(root, "fixture");
      await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
      const copy = await copyRepositoryRuntime(runtime, workspace);
      assert.equal(await fs.readFile(copy.codex, "utf8"), "codex");
      await fs.writeFile(runtime.codex, "changed");
      assert.equal(await fs.readFile(copy.codex, "utf8"), "codex");
      assert.equal((await fs.lstat(copy.node)).mode & 0o777, 0o555);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
