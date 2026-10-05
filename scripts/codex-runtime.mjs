import fs from "node:fs/promises";
import path from "node:path";

// Inspect only fixed repository-local paths. Never discover or copy installed
// host runtimes automatically; placing these two files requires user consent.
export async function repositoryRuntime(root) {
  const directory = path.join(root, ".codex", "runtime");
  for (const parent of [path.join(root, ".codex"), directory]) {
    let info;
    try { info = await fs.lstat(parent); } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("Repository runtime directory could not be checked.");
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Repository runtime directories must not be symlinks.");
    }
  }
  const runtime = { codex: path.join(directory, "codex"), node: path.join(directory, "node") };
  for (const file of Object.values(runtime)) {
    let info;
    try { info = await fs.lstat(file); } catch {
      throw new Error("Repository runtime is incomplete; both codex and node executables are required.");
    }
    if (!info.isFile() || info.isSymbolicLink() || !(info.mode & 0o111)) {
      throw new Error("Repository runtime requires regular executable files, not symlinks.");
    }
  }
  return runtime;
}

export async function copyRepositoryRuntime(runtime, workspace) {
  const directory = path.join(workspace, ".codex", "runtime");
  await fs.mkdir(directory);
  const target = { codex: path.join(directory, "codex"), node: path.join(directory, "node") };
  for (const name of ["codex", "node"]) {
    // Independent copies keep fixture changes from modifying the source files.
    await fs.copyFile(runtime[name], target[name]);
    await fs.chmod(target[name], 0o555);
  }
  return target;
}
