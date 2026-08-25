"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

function isTraceGlobOutsideRoot(pattern, root) {
  if (typeof pattern !== "string") return false;
  const staticPrefix = pattern.split(/[*?[\]{}]/, 1)[0];
  if (!path.isAbsolute(staticPrefix)) return false;

  const relative = path.relative(path.resolve(root), path.resolve(staticPrefix));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function filterPatterns(pattern, root) {
  if (Array.isArray(pattern)) {
    return pattern.filter((entry) => !isTraceGlobOutsideRoot(entry, root));
  }
  return isTraceGlobOutsideRoot(pattern, root) ? [] : pattern;
}

function isTracePathOutsideRoot(candidate, root, base = root) {
  if (typeof candidate !== "string") return false;

  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function createTraceIgnore(root, base, originalIgnore) {
  return (candidate, ...args) => {
    if (isTracePathOutsideRoot(candidate, root, base)) return true;
    return typeof originalIgnore === "function"
      ? Boolean(originalIgnore(candidate, ...args))
      : false;
  };
}

const traceRoot = process.env.PI_WEB_TRACE_ROOT || process.cwd();
const globModulePath = require.resolve("next/dist/compiled/glob");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const originalGlob = require(globModulePath);

function filteredGlob(pattern, options, callback) {
  const filtered = filterPatterns(pattern, traceRoot);
  if (Array.isArray(filtered) && filtered.length === 0) {
    const done = typeof options === "function" ? options : callback;
    if (typeof done === "function") {
      queueMicrotask(() => done(null, []));
      return undefined;
    }
    return [];
  }
  return originalGlob(filtered, options, callback);
}

Object.assign(filteredGlob, originalGlob);
filteredGlob.glob = filteredGlob;
filteredGlob.sync = (pattern, options) => {
  const filtered = filterPatterns(pattern, traceRoot);
  return Array.isArray(filtered) && filtered.length === 0
    ? []
    : originalGlob.sync(filtered, options);
};
require.cache[globModulePath].exports = filteredGlob;

// Next 16.3 bundles glob inside @vercel/nft, so patching next/dist/compiled/glob
// no longer protects output tracing from absolute paths outside the portable app.
// Wrap NFT's ignore callback as well, preserving Next's own ignore rules.
const nftModulePath = require.resolve("next/dist/compiled/@vercel/nft");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nftModule = require(nftModulePath);
const nftPatchMarker = Symbol.for("ate-agent.portable-nft-trace-filter");
if (!nftModule[nftPatchMarker]) {
  const originalNodeFileTrace = nftModule.nodeFileTrace;
  async function filteredNodeFileTrace(entries, options = {}) {
    const base = options.base || traceRoot;
    return originalNodeFileTrace.call(this, entries, {
      ...options,
      ignore: createTraceIgnore(traceRoot, base, options.ignore),
    });
  }
  Object.defineProperty(nftModule, "nodeFileTrace", {
    configurable: true,
    enumerable: true,
    value: filteredNodeFileTrace,
  });
  Object.defineProperty(nftModule, nftPatchMarker, { value: true });
}

module.exports = {
  createTraceIgnore,
  filterPatterns,
  isTraceGlobOutsideRoot,
  isTracePathOutsideRoot,
};
