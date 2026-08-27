import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewerSource = await readFile(new URL("./BrowserViewer.tsx", import.meta.url), "utf8");
const configSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

test("browser preview validates navigation against the current app origin", () => {
  assert.match(viewerSource, /normalizeBrowserAddress\(rawAddress, window\.location\.origin\)/);
  assert.match(viewerSource, /window\.location\.hostname/);
  assert.match(viewerSource, /window\.open\(currentUrl, "_blank", "noopener,noreferrer"\)/);
});

test("browser preview grants only the iframe capabilities it needs", () => {
  const sandbox = viewerSource.match(/sandbox="([^"]+)"/)?.[1];
  assert.equal(sandbox, "allow-forms allow-same-origin allow-scripts");
  assert.doesNotMatch(sandbox, /allow-downloads|allow-modals|allow-popups|allow-top-navigation/);
  assert.match(viewerSource, /allow="camera 'none'; clipboard-read 'none'; clipboard-write 'none'; geolocation 'none'; microphone 'none'"/);
  assert.match(viewerSource, /referrerPolicy="strict-origin-when-cross-origin"/);
});

test("an external-browser fallback remains available even when iframe errors are opaque", () => {
  const navigationStart = viewerSource.indexOf('<div className="browser-navigation">');
  const viewportStart = viewerSource.indexOf('<div className="browser-viewport"');
  const externalButton = viewerSource.indexOf('className="browser-external-button"');
  assert.ok(navigationStart >= 0 && externalButton > navigationStart && externalButton < viewportStart);
  assert.match(viewerSource, /t\("browser\.embedNotice"\)/);
  assert.doesNotMatch(viewerSource, /<iframe[\s\S]*?onError=/);
});

test("the preview reports its loading state without claiming opaque iframe failures", () => {
  assert.match(viewerSource, /aria-busy=\{loadState === "loading"\}/);
  assert.match(viewerSource, /const addressErrorId = useId\(\)/);
  assert.match(viewerSource, /aria-describedby=\{addressError \? addressErrorId : undefined\}/);
  assert.doesNotMatch(viewerSource, /<iframe[\s\S]*?onError=/);
});

test("the app refuses to render itself inside the permissive same-origin sandbox", () => {
  assert.match(configSource, /Content-Security-Policy", value: "frame-ancestors 'none'"/);
  assert.match(configSource, /X-Frame-Options", value: "DENY"/);
});
