import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./route.ts");
const { closeBrowserPreviewProxies } = await jiti.import("@/lib/browser-preview-proxy");

let targetServer;
let targetUrl;

function requestFor(url, headers = {}) {
  return new Request("http://127.0.0.1:30141/api/browser-preview", {
    method: "POST",
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ url }),
  });
}

before(async () => {
  targetServer = createServer((_request, response) => {
    response.writeHead(200, { "x-frame-options": "DENY" });
    response.end("LOCAL_PREVIEW_OK");
  });
  await new Promise((resolve, reject) => {
    targetServer.once("error", reject);
    targetServer.listen(0, "127.0.0.1", resolve);
  });
  targetUrl = `http://127.0.0.1:${targetServer.address().port}/`;
});

after(async () => {
  await closeBrowserPreviewProxies();
  await new Promise((resolve) => targetServer.close(resolve));
});

test("creates a same-site preview URL for a same-origin loopback request", async () => {
  const response = await POST(requestFor(targetUrl));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.match(payload.previewUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.notEqual(new URL(payload.previewUrl).port, "30141");

  const preview = await fetch(payload.previewUrl);
  assert.equal(await preview.text(), "LOCAL_PREVIEW_OK");
  assert.equal(preview.headers.get("x-frame-options"), null);
});

test("rejects cross-site control requests", async () => {
  const response = await POST(requestFor(targetUrl, {
    origin: "https://attacker.example",
    "sec-fetch-site": "cross-site",
  }));
  assert.equal(response.status, 403);
});

test("rejects the current app and proxy recursion", async () => {
  const currentApp = await POST(requestFor("http://localhost:30141/"));
  assert.equal(currentApp.status, 400);

  const created = await POST(requestFor(targetUrl));
  const { previewUrl } = await created.json();
  const recursive = await POST(requestFor(previewUrl));
  assert.equal(recursive.status, 403);
});
