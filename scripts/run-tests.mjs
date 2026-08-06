import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const IGNORED_DIRECTORIES = new Set([".git", ".next", "build", "node_modules"]);

export function findTestFiles(root) {
  const files = [];
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        pending.push(join(directory, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        files.push(join(directory, entry.name));
      }
    }
  }
  return files.sort();
}

export function runTests(root) {
  const files = findTestFiles(root);
  // 显式传入测试文件，避免 Node 把 models-config/test 等生产路由目录误判为测试目录。
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = runTests(resolve(import.meta.dirname, ".."));
}
