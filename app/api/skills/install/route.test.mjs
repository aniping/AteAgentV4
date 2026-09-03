import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("marketplace install rejects missing and unknown scopes", async () => {
  const { POST } = await jiti.import("./route.ts");

  for (const scope of [undefined, "workspace"]) {
    const response = await POST(new Request("http://127.0.0.1/api/skills/install", {
      method: "POST",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ package: "owner/example-skill", scope }),
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /scope must be global or project/);
  }

  const nullBodyResponse = await POST(new Request("http://127.0.0.1/api/skills/install", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: "null",
  }));
  assert.equal(nullBodyResponse.status, 400);
});
