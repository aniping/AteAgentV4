import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { patchPiMcpAdapter } = require("./patch-pi-mcp-adapter.cjs");

function writeFixture(root) {
  const adapterRoot = join(root, "node_modules", "pi-mcp-adapter");
  mkdirSync(adapterRoot, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n", "utf8");
  writeFileSync(
    join(adapterRoot, "package.json"),
    `${JSON.stringify({ version: "2.20.1", exports: { ".": "./index.ts" } }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(adapterRoot, "index.ts"), "export default function adapter() {}\n", "utf8");
  writeFileSync(
    join(adapterRoot, "types.ts"),
    "export interface ServerEntry {\n  // Direct tool registration\n  directTools?: boolean | string[];\n}\n",
    "utf8",
  );
  writeFileSync(
    join(adapterRoot, "direct-tools.ts"),
    [
      "function resolve(envSelection, definition, serverName) {",
      "    if (envSelection) {",
      "      if (envSelection.servers.has(serverName)) {",
      "        return true;",
      "      }",
      "    }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(adapterRoot, "metadata-cache.ts"),
    [
      "function missing(envSelection, definition, serverName) {",
      "    const hasDirectTools = envSelection",
      "      ? envSelection.servers.has(serverName) || envSelection.tools.has(serverName)",
      "      : false;",
      "    return hasDirectTools;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return adapterRoot;
}

test("pi-mcp-adapter compatibility patch is deterministic and checkable", () => {
  const root = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-patch-"));
  try {
    const adapterRoot = writeFixture(root);
    assert.throws(
      () => patchPiMcpAdapter(root, { checkOnly: true }),
      /compatibility patch is not installed/,
    );

    patchPiMcpAdapter(root);
    patchPiMcpAdapter(root, { checkOnly: true });
    const patched = ["types.ts", "direct-tools.ts", "metadata-cache.ts"]
      .map((file) => readFileSync(join(adapterRoot, file), "utf8"));
    assert.ok(patched.every((source) => source.includes("ignoreDirectToolsEnv")));

    patchPiMcpAdapter(root);
    assert.deepEqual(
      ["types.ts", "direct-tools.ts", "metadata-cache.ts"]
        .map((file) => readFileSync(join(adapterRoot, file), "utf8")),
      patched,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
