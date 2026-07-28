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

module.exports = { filterPatterns, isTraceGlobOutsideRoot };
