import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("skills API rejects an unknown scene", async () => {
  const { GET } = await jiti.import("./route.ts");
  const response = await GET(new Request("http://127.0.0.1/api/skills?cwd=C%3A%2Fproject&sceneId=debug"));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid scene/);
});

test("bundled scene resources cannot be edited through the skills API", async () => {
  const { PATCH } = await jiti.import("./route.ts");
  const filePath = resolve("bundled-resources/scenes/design/AGENTS.md");
  const response = await PATCH(new Request("http://127.0.0.1/api/skills", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filePath, disableModelInvocation: true }),
  }));

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /read-only/);
});
