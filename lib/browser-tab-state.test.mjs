import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserTabState,
  formatBrowserPreviewHost,
  getBrowserTabLabel,
  getCurrentBrowserUrl,
  isLocalBrowserUrl,
  moveBrowserHistory,
  navigateBrowserTabState,
  normalizeBrowserAddress,
  reloadBrowserTab,
} from "./browser-tab-state.ts";

test("normalizes local development addresses to HTTP and public hosts to HTTPS", () => {
  assert.deepEqual(normalizeBrowserAddress("localhost:5173/path"), {
    ok: true,
    url: "http://localhost:5173/path",
  });
  assert.deepEqual(normalizeBrowserAddress("127.0.0.1:3000"), {
    ok: true,
    url: "http://127.0.0.1:3000/",
  });
  assert.deepEqual(normalizeBrowserAddress("example.com/docs"), {
    ok: true,
    url: "https://example.com/docs",
  });
  assert.deepEqual(normalizeBrowserAddress("192.168.1.20:5173/app"), {
    ok: true,
    url: "http://192.168.1.20:5173/app",
  });
  assert.deepEqual(normalizeBrowserAddress("devbox:5173"), {
    ok: true,
    url: "http://devbox:5173/",
  });
  assert.deepEqual(normalizeBrowserAddress("preview.local:8080"), {
    ok: true,
    url: "http://preview.local:8080/",
  });
  assert.deepEqual(normalizeBrowserAddress("example.com:443"), {
    ok: true,
    url: "https://example.com/",
  });
});

test("formats IPv4, DNS, and already-bracketed IPv6 preview hosts", () => {
  assert.equal(formatBrowserPreviewHost("127.0.0.1"), "127.0.0.1");
  assert.equal(formatBrowserPreviewHost("devbox.local"), "devbox.local");
  assert.equal(formatBrowserPreviewHost("::1"), "[::1]");
  assert.equal(formatBrowserPreviewHost("[fd00::1]"), "[fd00::1]");
});

test("accepts only HTTP(S) and does not recursively embed the current app", () => {
  assert.deepEqual(normalizeBrowserAddress("javascript:alert(1)"), {
    ok: false,
    error: "unsupported",
  });
  assert.deepEqual(normalizeBrowserAddress("file:///tmp/demo.html"), {
    ok: false,
    error: "unsupported",
  });
  assert.deepEqual(normalizeBrowserAddress("http://127.0.0.1:30141/docs", "http://127.0.0.1:30141"), {
    ok: false,
    error: "current-app",
  });
  assert.deepEqual(normalizeBrowserAddress("http://localhost:30141/docs", "http://127.0.0.1:30141"), {
    ok: false,
    error: "current-app",
  });
  assert.deepEqual(normalizeBrowserAddress("http://[::1]:30141/docs", "http://localhost:30141"), {
    ok: false,
    error: "current-app",
  });
  assert.deepEqual(normalizeBrowserAddress("https://user:secret@example.com"), {
    ok: false,
    error: "credentials",
  });
});

test("bounds address-bar history", () => {
  let state = createBrowserTabState();
  for (let index = 0; index < 60; index += 1) {
    state = navigateBrowserTabState(state, `https://example.com/${index}`);
  }
  assert.equal(state.history.length, 50);
  assert.equal(state.history[0], "https://example.com/10");
  assert.equal(state.historyIndex, 49);
});

test("keeps address-bar history, truncates forward entries, and reloads duplicates", () => {
  const blank = createBrowserTabState();
  const first = navigateBrowserTabState(blank, "http://localhost:3000/");
  const second = navigateBrowserTabState(first, "http://localhost:5173/");
  const back = moveBrowserHistory(second, -1);

  assert.equal(getCurrentBrowserUrl(back), "http://localhost:3000/");
  assert.strictEqual(moveBrowserHistory(back, -1), back);

  const replacedForward = navigateBrowserTabState(back, "https://example.com/");
  assert.deepEqual(replacedForward.history, ["http://localhost:3000/", "https://example.com/"]);
  assert.equal(replacedForward.historyIndex, 1);

  const reloaded = navigateBrowserTabState(replacedForward, "https://example.com/");
  assert.equal(reloaded.reloadRevision, 1);
  assert.deepEqual(reloaded.history, replacedForward.history);
  assert.equal(reloadBrowserTab(reloaded).reloadRevision, 2);
});

test("derives compact labels and identifies loopback previews", () => {
  const state = createBrowserTabState("http://localhost:4173/settings");
  assert.equal(getBrowserTabLabel(state, "Browser"), "localhost:4173");
  assert.equal(isLocalBrowserUrl(getCurrentBrowserUrl(state)), true);
  assert.equal(isLocalBrowserUrl("http://192.168.1.20:5173/"), true);
  assert.equal(isLocalBrowserUrl("http://[fd00::1]:5173/"), true);
  assert.equal(isLocalBrowserUrl("https://example.com/"), false);
});
