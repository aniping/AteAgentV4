import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("skill ZIP upload rejects a malformed archive without writing it", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { POST } = await jiti.import("./route.ts");
  const form = new FormData();
  form.set("file", new File(["not a zip"], "broken.zip", { type: "application/zip" }));
  form.set("scope", "global");
  form.set("cwd", process.cwd());
  const request = new Request("http://127.0.0.1/api/skills/upload", {
    method: "POST",
    headers: { host: "127.0.0.1" },
    body: form,
  });

  const response = await POST(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Invalid or corrupted ZIP/);
});

test("MCP adapter reuse follows Pi's resolved extension state", async () => {
  const { hasUsableMcpAdapter } = await jiti.import("@/lib/mcp-adapter");
  const resource = (scope, enabled = true) => ({
    path: "C:/packages/pi-mcp-adapter/extensions/index.js",
    enabled,
    metadata: { source: "npm:pi-mcp-adapter", scope, origin: "package" },
  });

  assert.equal(hasUsableMcpAdapter([resource("project")], "project"), true);
  assert.equal(hasUsableMcpAdapter([resource("project")], "global"), false);
  assert.equal(hasUsableMcpAdapter([resource("user")], "project"), true);
  assert.equal(hasUsableMcpAdapter([resource("user")], "global"), true);
  assert.equal(hasUsableMcpAdapter([resource("project", false)], "project"), false);
  assert.equal(hasUsableMcpAdapter([resource("temporary")], "project"), false);
  assert.equal(
    hasUsableMcpAdapter([
      { ...resource("user"), metadata: { ...resource("user").metadata, source: "npm:another-adapter" } },
    ], "project"),
    false,
  );
  assert.equal(
    hasUsableMcpAdapter([
      { ...resource("project"), metadata: { ...resource("project").metadata, origin: "top-level" } },
    ], "project"),
    false,
  );
});

test("a successful project upload records the explicit project trust decision", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(scope === "project"\) trustProject\(cwd, agentDir\)/);
});

test("skill archive uninstall rejects an unsafe skill name", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { DELETE } = await jiti.import("./route.ts");
  const request = new Request("http://127.0.0.1/api/skills/upload", {
    method: "DELETE",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({ cwd: process.cwd(), scope: "global", skillName: "../escape" }),
  });

  const response = await DELETE(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Invalid skill name/);
});
