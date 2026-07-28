import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  filterPatterns,
  isTraceGlobOutsideRoot,
} = require("./portable-build-preload.cjs");

test("portable tracing rejects absolute globs outside the project root", () => {
  const root = path.resolve("portable-test-root");
  const outsidePattern = path.join(path.dirname(root), "outside", "**", "*");
  const insidePattern = path.join(root, "node_modules", "**", "*");

  assert.equal(isTraceGlobOutsideRoot(outsidePattern, root), true);
  assert.equal(isTraceGlobOutsideRoot(insidePattern, root), false);
  assert.equal(isTraceGlobOutsideRoot(".next/server/**/*", root), false);
});

test("portable tracing preserves inside patterns and removes outside patterns", () => {
  const root = path.resolve("portable-test-root");
  const outsidePattern = path.join(path.dirname(root), "outside", "**", "*");
  const insidePattern = path.join(root, ".next", "**", "*");

  assert.deepEqual(
    filterPatterns([
      outsidePattern,
      insidePattern,
    ], root),
    [insidePattern],
  );
  assert.deepEqual(filterPatterns(outsidePattern, root), []);
});
