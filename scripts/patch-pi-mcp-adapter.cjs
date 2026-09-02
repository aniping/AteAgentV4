"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join, resolve } = require("node:path");

const EXPECTED_VERSION = "2.20.1";

const PATCHES = [
  {
    file: "types.ts",
    before: "  // Direct tool registration\n  directTools?: boolean | string[];",
    after: [
      "  // Direct tool registration",
      "  directTools?: boolean | string[];",
      "  /** Ignore MCP_DIRECT_TOOLS for this server while preserving it for other servers. */",
      "  ignoreDirectToolsEnv?: boolean;",
    ].join("\n"),
  },
  {
    file: "direct-tools.ts",
    before: "    if (envSelection) {\n      if (envSelection.servers.has(serverName)) {",
    after: "    if (envSelection && definition.ignoreDirectToolsEnv !== true) {\n      if (envSelection.servers.has(serverName)) {",
  },
  {
    file: "metadata-cache.ts",
    before: "    const hasDirectTools = envSelection\n      ? envSelection.servers.has(serverName) || envSelection.tools.has(serverName)",
    after: "    const hasDirectTools = envSelection && definition.ignoreDirectToolsEnv !== true\n      ? envSelection.servers.has(serverName) || envSelection.tools.has(serverName)",
  },
];

function resolveAdapterRoot(projectRoot) {
  const projectRequire = createRequire(join(projectRoot, "package.json"));
  return dirname(projectRequire.resolve("pi-mcp-adapter"));
}

function patchSource(source, patch, checkOnly) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized.includes(patch.after)) return source;
  const occurrences = normalized.split(patch.before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${patch.file}: expected one compatible patch anchor, found ${occurrences}`);
  }
  if (checkOnly) {
    throw new Error(`${patch.file}: pi-mcp-adapter compatibility patch is not installed`);
  }
  return normalized.replace(patch.before, patch.after).replace(/\n/g, newline);
}

function patchPiMcpAdapter(projectRoot = resolve(__dirname, ".."), { checkOnly = false } = {}) {
  const adapterRoot = resolveAdapterRoot(projectRoot);
  const manifest = JSON.parse(readFileSync(join(adapterRoot, "package.json"), "utf8"));
  if (manifest.version !== EXPECTED_VERSION) {
    throw new Error(
      `pi-mcp-adapter ${EXPECTED_VERSION} is required for the bundled compatibility patch; found ${manifest.version}`,
    );
  }

  for (const patch of PATCHES) {
    const filePath = join(adapterRoot, patch.file);
    const source = readFileSync(filePath, "utf8");
    const patched = patchSource(source, patch, checkOnly);
    if (patched !== source) writeFileSync(filePath, patched, "utf8");
  }
}

if (require.main === module) {
  try {
    patchPiMcpAdapter(resolve(__dirname, ".."), { checkOnly: process.argv.includes("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { patchPiMcpAdapter };
