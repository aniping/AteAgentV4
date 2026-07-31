import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appFavicon = new URL("../app/favicon.ico", import.meta.url);
const appIcon = new URL("../app/icon.svg", import.meta.url);
const rootLayout = new URL("../app/layout.tsx", import.meta.url);
const manifest = new URL("../app/manifest.ts", import.meta.url);
const pwaRegistration = new URL("../components/PwaRegistration.tsx", import.meta.url);
const offlinePage = new URL("../public/offline.html", import.meta.url);
const serviceWorker = new URL("../public/sw.js", import.meta.url);
const webProxy = new URL("../proxy.ts", import.meta.url);
const cliLauncher = new URL("../bin/pi-web.js", import.meta.url);
const russianReadme = new URL("../README.ru.md", import.meta.url);
const packageScript = new URL("./package-installer.cjs", import.meta.url);
const pwaIcons = new Map([
  [new URL("../public/icons/apple-touch-icon.png", import.meta.url), "80147b725be98444294fdc66989f3ae330bc78a4a0129ee997341d30b4edcf10"],
  [new URL("../public/icons/icon-192.png", import.meta.url), "6b42a850d89ca14e7adbf41a0dc4bfe01252b43a6f027c348eacb6d5c576ac1d"],
  [new URL("../public/icons/icon-512.png", import.meta.url), "0785ee169a5f0c7e8203ac49fcdfd2ccd556e47fed5343287cade2ab871aa5fa"],
]);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test("browser metadata uses the canonical ATE Agent icon", async () => {
  assert.equal(
    await exists(appFavicon),
    false,
    "legacy app/favicon.ico overrides the ATE Agent browser icon",
  );

  const [browserIcon, layoutSource, installerSource] = await Promise.all([
    readFile(appIcon, "utf8"),
    readFile(rootLayout, "utf8"),
    readFile(packageScript, "utf8"),
  ]);
  assert.match(browserIcon, /fill="#fb3a4e"/);
  assert.match(browserIcon, /M11\.4 34\.4 22\.8 10\.6 34\.4 34\.4/);
  assert.match(layoutSource, /title:\s*"ATE Agent"/);
  assert.doesNotMatch(layoutSource, /Pi Web/i);
  assert.match(installerSource, /path\.join\(repoRoot, "app", "icon\.svg"\)/);
});

test("PWA metadata and assets use ATE Agent branding", async () => {
  const brandedSources = await Promise.all([
    readFile(rootLayout, "utf8"),
    readFile(manifest, "utf8"),
    readFile(pwaRegistration, "utf8"),
    readFile(offlinePage, "utf8"),
    readFile(serviceWorker, "utf8"),
  ]);

  for (const source of brandedSources) {
    assert.match(source, /ATE Agent|ate-agent/);
    assert.doesNotMatch(source, /Pi Web|pi-web/i);
  }

  for (const [icon, expectedHash] of pwaIcons) {
    const actualHash = createHash("sha256").update(await readFile(icon)).digest("hex");
    assert.equal(actualHash, expectedHash);
  }
});

test("PWA fetches Next.js static assets before falling back to cache", async () => {
  const source = await readFile(serviceWorker, "utf8");

  assert.match(
    source,
    /url\.pathname\.startsWith\("\/_next\/static\/"\)[\s\S]*?networkFirst\(request\)/,
  );
  assert.match(
    source,
    /async function networkFirst\(request\)[\s\S]*?await fetch\(request\)[\s\S]*?await caches\.match\(request\)/,
  );
});

test("password authentication uses ATE Agent branding without Russian documentation", async () => {
  const [proxySource, launcherSource] = await Promise.all([
    readFile(webProxy, "utf8"),
    readFile(cliLauncher, "utf8"),
  ]);

  assert.match(proxySource, /Basic realm="ATE Agent"/);
  assert.doesNotMatch(proxySource, /Basic realm="Pi Web"/i);
  assert.match(launcherSource, /Warning: ATE Agent is listening/);
  assert.doesNotMatch(launcherSource, /Warning: pi-web is listening/i);
  assert.equal(await exists(russianReadme), false);
});
