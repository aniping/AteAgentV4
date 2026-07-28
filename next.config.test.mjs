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
