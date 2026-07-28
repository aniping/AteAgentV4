import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("Next proxy preserves requests up to the bounded skill upload limit", async () => {
  const { default: config } = await jiti.import("./next.config.ts");
  const { MAX_SKILL_ARCHIVE_BYTES } = await jiti.import("./lib/skill-archive.ts");

  assert.ok(
    config.experimental?.proxyClientMaxBodySize >= MAX_SKILL_ARCHIVE_BYTES + 2 * 1024 * 1024,
  );
});

test("portable builds trace Pi runtime assets loaded dynamically from disk", async () => {
  const previousStandalone = process.env.PI_WEB_STANDALONE;
  process.env.PI_WEB_STANDALONE = "1";
  try {
    const standaloneJiti = createJiti(import.meta.url, { moduleCache: false });
    const { default: config } = await standaloneJiti.import("./next.config.ts");
    const includes = config.outputFileTracingIncludes?.["/*"] ?? [];

    assert.ok(
      includes.includes("./node_modules/@earendil-works/pi-coding-agent/dist/**/*"),
      "portable builds must include Pi assets such as dark.json and export templates",
    );
  } finally {
    if (previousStandalone === undefined) delete process.env.PI_WEB_STANDALONE;
    else process.env.PI_WEB_STANDALONE = previousStandalone;
  }
});
