import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkPermissions } from "./codex-permissions.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.length === 1 && args[0] === "--check";

try {
  if (path.resolve(process.cwd()) !== path.resolve(root)) throw new Error("Run this launcher from the repository root.");
  // No flag forwarding: later overrides must not broaden a checked policy.
  if (!checkOnly && (args.length > 1 || args.some(arg => arg.startsWith("-")))) {
    throw new Error("Only --check or one optional initial prompt is accepted; permission overrides are refused.");
  }
  const result = await checkPermissions(root);
  console.log("Codex permission preflight passed: " + JSON.stringify(result));
  if (!checkOnly) {
    // Start a new local server instead of reusing a daemon with older settings.
    const child = spawn("codex", ["--strict-config", "--no-daemon", ...args], { cwd: root, stdio: "inherit" });
    child.on("error", () => { console.error("Codex could not start."); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error("Codex startup refused: " + error.message);
  process.exitCode = 1;
}
