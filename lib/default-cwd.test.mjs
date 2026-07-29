import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./default-cwd.ts");
}

test("uses the ATE prefix for the dated default workspace", async () => {
  const { DEFAULT_CWD_NAME_PATTERN, getDefaultCwdName } = await loadSubject();

  assert.equal(getDefaultCwdName(new Date("2026-07-29T08:00:00.000Z")), "ate-cwd-20260729");
  assert.equal(DEFAULT_CWD_NAME_PATTERN.test("ate-cwd-20260729"), true);
  assert.equal(DEFAULT_CWD_NAME_PATTERN.test("pi-cwd-20260729"), false);
});
