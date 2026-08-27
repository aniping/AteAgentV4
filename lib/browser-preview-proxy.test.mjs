import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { after, before, test } from "node:test";

import {
  BrowserPreviewProxyError,
  closeBrowserPreviewProxies,
  createBrowserPreviewUrl,
  stripFrameAncestorsDirective,
} from "./browser-preview-proxy.ts";

let upstream;
let upstreamOrigin;
const proxyOptions = {
  parentOrigin: "http://127.0.0.1:30141",
  forbiddenOrigins: ["http://127.0.0.1:30141"],
};

function requestPreview(rawUrl, headers = {}) {
  const url = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => resolve({ response, body }));
    });
    request.once("error", reject);
    request.end();
  });
}

before(async () => {
  upstream = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
        "set-cookie": [
          "session=one; Domain=127.0.0.1; Path=/; HttpOnly",
          "theme=dark; Path=/; SameSite=Lax",
        ],
      });
      response.end('<div id="app"></div><script type="module" src="/assets/app.js"></script>');
      return;
    }
    if (request.url === "/assets/app.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end('document.querySelector("#app").textContent = "VITE_READY";');
      return;
    }
    if (request.url === "/api/state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ready: true, host: request.headers.host }));
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `${upstreamOrigin}/final` });
      response.end();
      return;
    }
    if (request.url === "/dir/start") {
      response.writeHead(302, { location: "next?from=relative" });
      response.end();
      return;
    }
    if (request.url === "/final") {
      response.end("FINAL");
      return;
    }
    if (request.url === "/echo" && request.method === "POST") {
      response.writeHead(200, { "content-type": request.headers["content-type"] ?? "text/plain" });
      request.pipe(response);
      return;
    }
    if (request.url === "/truncated") {
      response.writeHead(200, { "content-length": "100" });
      response.write("short");
      setImmediate(() => response.destroy());
      return;
    }
    if (request.url === "/unexpected-upgrade") {
      response.writeHead(101, { connection: "Upgrade", upgrade: "websocket" });
      response.end();
      return;
    }
    if (request.url?.startsWith("/csp-")) {
      const frameFirst = request.url.includes("frame-first");
      const policies = frameFirst
        ? ["frame-ancestors 'none'", "default-src 'self'"]
        : ["default-src 'self'", "frame-ancestors 'none'"];
      if (request.url.includes("combined")) {
        response.setHeader("content-security-policy", policies.join(", "));
        response.end("CSP_OK");
        return;
      }
      response.setHeader("content-security-policy", policies);
      response.end("CSP_OK");
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  upstream.on("upgrade", (request, socket) => {
    if (request.url !== "/socket") {
      socket.destroy();
      return;
    }
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nUPGRADE_OK");
  });
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address();
  upstreamOrigin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await closeBrowserPreviewProxies();
  await new Promise((resolve) => upstream.close(resolve));
});

test("removes only frame embedding restrictions from CSP", () => {
  assert.equal(
    stripFrameAncestorsDirective("default-src 'self'; frame-ancestors 'none'; script-src 'self'"),
    "default-src 'self'; script-src 'self'",
  );
  assert.equal(stripFrameAncestorsDirective("frame-ancestors 'none'"), null);
});

test("proxies Vite-style root assets and APIs on a same-site loopback origin", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/`, proxyOptions);
  const previewOrigin = new URL(previewUrl).origin;
  assert.notEqual(previewOrigin, upstreamOrigin);
  assert.equal(new URL(previewOrigin).hostname, "127.0.0.1");
  assert.match(previewOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);

  const page = await fetch(previewUrl);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), null);
  assert.equal(
    page.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self', frame-ancestors http://127.0.0.1:30141",
  );
  assert.deepEqual(page.headers.getSetCookie(), [
    "session=one; Path=/; HttpOnly",
    "theme=dark; Path=/; SameSite=Lax",
  ]);
  assert.match(await page.text(), /src="\/assets\/app\.js"/);

  const script = await fetch(new URL("/assets/app.js", previewUrl));
  assert.equal(script.status, 200);
  assert.match(await script.text(), /VITE_READY/);

  const api = await fetch(new URL("/api/state", previewUrl));
  assert.deepEqual(await api.json(), {
    ready: true,
    host: new URL(upstreamOrigin).host,
  });
});

test("preserves request bodies and rewrites same-target redirects", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/echo`, proxyOptions);
  const echoed = await fetch(previewUrl, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "proxy-body",
  });
  assert.equal(await echoed.text(), "proxy-body");

  const redirect = await fetch(new URL("/redirect", previewUrl), { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), `${new URL(previewUrl).origin}/final`);

  const relativeRedirect = await fetch(new URL("/dir/start", previewUrl), { redirect: "manual" });
  assert.equal(
    relativeRedirect.headers.get("location"),
    `${new URL(previewUrl).origin}/dir/next?from=relative`,
  );
});

test("forwards WebSocket upgrade requests to the local service", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/socket`, proxyOptions);
  const preview = new URL(previewUrl);
  const response = await new Promise((resolve, reject) => {
    const socket = connect(Number(preview.port), preview.hostname);
    let received = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      received += chunk;
      if (received.includes("UPGRADE_OK")) {
        socket.destroy();
        resolve(received);
      }
    });
    socket.once("connect", () => {
      socket.write(
        `GET /socket HTTP/1.1\r\nHost: ${preview.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
  });
  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/m);
  assert.match(response, /UPGRADE_OK/);
});

test("terminates a truncated upstream response instead of leaving the browser pending", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/truncated`, proxyOptions);
  let timeout;
  const outcome = await Promise.race([
    fetch(previewUrl).then((response) => response.text()).then(
      () => "completed",
      () => "rejected",
    ),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), 1_500);
    }),
  ]);
  clearTimeout(timeout);
  assert.equal(outcome, "rejected");
});

test("rejects an unexpected upstream upgrade on the normal HTTP path", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/unexpected-upgrade`, proxyOptions);
  let timeout;
  const outcome = await Promise.race([
    fetch(previewUrl).then((response) => response.status, () => "rejected"),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), 1_500);
    }),
  ]);
  clearTimeout(timeout);
  assert.equal(outcome, 502);
});

test("preserves every non-frame directive from repeated CSP headers", async () => {
  for (const path of [
    "/csp-frame-first",
    "/csp-frame-last",
    "/csp-combined-frame-first",
    "/csp-combined-frame-last",
  ]) {
    const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}${path}`, proxyOptions);
    const { response } = await requestPreview(previewUrl);
    assert.deepEqual(response.headersDistinct["content-security-policy"], [
      "default-src 'self'",
      "frame-ancestors http://127.0.0.1:30141",
    ]);
  }
});

test("rejects mismatched Host, cross-site HTTP, and mismatched WebSocket requests", async () => {
  const previewUrl = await createBrowserPreviewUrl(`${upstreamOrigin}/`, proxyOptions);
  const preview = new URL(previewUrl);
  const mismatchedHost = await requestPreview(previewUrl, {
    host: `attacker.example:${preview.port}`,
  });
  assert.equal(mismatchedHost.response.statusCode, 421);
  assert.doesNotMatch(mismatchedHost.body, /VITE_READY/);

  const crossSite = await requestPreview(previewUrl, {
    origin: "http://attacker.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(crossSite.response.statusCode, 421);

  const socketResponse = await new Promise((resolve, reject) => {
    const socket = connect(Number(preview.port), preview.hostname);
    let received = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => { received += chunk; });
    socket.once("end", () => resolve(received));
    socket.once("connect", () => {
      socket.write(
        `GET /socket HTTP/1.1\r\nHost: attacker.example:${preview.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://attacker.example\r\n\r\n`,
      );
    });
  });
  assert.match(socketResponse, /^HTTP\/1\.1 421 Misdirected Request/m);
});

test("reuses one proxy per target origin and rejects public or recursive targets", async () => {
  const first = await createBrowserPreviewUrl(`${upstreamOrigin}/one`, proxyOptions);
  const second = await createBrowserPreviewUrl(`${upstreamOrigin}/two`, proxyOptions);
  assert.equal(new URL(first).origin, new URL(second).origin);

  const alias = await createBrowserPreviewUrl(
    `${upstreamOrigin.replace("127.0.0.1", "localhost")}/alias`,
    proxyOptions,
  );
  assert.equal(new URL(alias).hostname, new URL(first).hostname);
  assert.notEqual(new URL(alias).origin, new URL(first).origin);

  await assert.rejects(
    () => createBrowserPreviewUrl("http://8.8.8.8/", proxyOptions),
    (error) => error instanceof BrowserPreviewProxyError && error.code === "target-not-local",
  );
  await assert.rejects(
    () => createBrowserPreviewUrl("http://192.168.1.1/", proxyOptions),
    (error) => error instanceof BrowserPreviewProxyError && error.code === "target-not-local",
  );
  await assert.rejects(
    () => createBrowserPreviewUrl("http://169.254.169.254/latest/meta-data/", proxyOptions),
    (error) => error instanceof BrowserPreviewProxyError && error.code === "target-not-local",
  );
  await assert.rejects(
    () => createBrowserPreviewUrl(first, proxyOptions),
    (error) => error instanceof BrowserPreviewProxyError && error.code === "recursive-target",
  );
});
