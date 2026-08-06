import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { findTestFiles } from "./run-tests.mjs";

test("test discovery includes test files and excludes production test routes", () => {
  const root = resolve(import.meta.dirname, "..");
  const files = findTestFiles(root);
  const portableFiles = files.map((file) => file.replaceAll("\\", "/"));

  assert.ok(portableFiles.some((file) => file.endsWith("app/api/plugins/route.test.mjs")));
  assert.ok(portableFiles.some((file) => file.endsWith("components/MermaidBlock.test.mjs")));
  assert.ok(files.every((file) => file.endsWith(".test.mjs")));
  assert.ok(!portableFiles.some((file) => file.endsWith("app/api/models-config/test/route.ts")));
});
