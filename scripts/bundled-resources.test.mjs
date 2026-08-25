import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { copyBundledResources, validateBundledResources } = require("./bundled-resources.cjs");
const sourceRoot = resolve(import.meta.dirname, "../bundled-resources");

test("bundled resources validate and copy into the standalone app root", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-bundle-"));
  try {
    const appRoot = join(tempRoot, "app");
    const manifest = validateBundledResources(sourceRoot);
    assert.deepEqual(manifest.scenes.map((scene) => scene.id), [
      "requirements", "design", "development", "integration", "testing",
    ]);
    const destination = copyBundledResources(sourceRoot, appRoot);
    assert.deepEqual(
      JSON.parse(readFileSync(join(destination, "bundle.json"), "utf8")),
      manifest,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a resource path outside the bundle root", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-bundle-invalid-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const manifestPath = join(bundleRoot, "bundle.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scenes[0].instructions = "../outside/AGENTS.md";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    assert.throws(() => validateBundledResources(bundleRoot), /escapes bundle root/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
