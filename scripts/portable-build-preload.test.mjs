import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createTraceIgnore,
  filterPatterns,
  isTraceGlobOutsideRoot,
  isTracePathOutsideRoot,
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

test("portable tracing rejects NFT paths outside the project root", () => {
  const root = path.resolve("portable-test-root");
  const outsidePath = path.join(path.dirname(root), "outside", "secret.txt");
  const insidePath = path.join(root, ".next", "server.js");

  assert.equal(isTracePathOutsideRoot(outsidePath, root, root), true);
  assert.equal(isTracePathOutsideRoot(insidePath, root, root), false);
  assert.equal(isTracePathOutsideRoot(".next/server.js", root, root), false);
});

test("portable tracing rejects NFT paths on another Windows drive", {
  skip: process.platform !== "win32",
}, () => {
  assert.equal(
    isTracePathOutsideRoot("C:\\Users\\Administrator", "I:\\ai\\cc\\AteAgentV4", "I:\\ai\\cc\\AteAgentV4"),
    true,
  );
});

test("portable tracing composes its root boundary with Next's ignore callback", () => {
  const root = path.resolve("portable-test-root");
  const ignoredByNext = path.join(root, "ignored-by-next.js");
  const included = path.join(root, "included.js");
  const outside = path.join(path.dirname(root), "outside.js");
  const seen = [];
  const ignore = createTraceIgnore(root, root, (candidate) => {
    seen.push(candidate);
    return candidate === ignoredByNext;
  });

  assert.equal(ignore(outside), true);
  assert.equal(ignore(ignoredByNext), true);
  assert.equal(ignore(included), false);
  assert.deepEqual(seen, [ignoredByNext, included]);
});
