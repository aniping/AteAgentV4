import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appFavicon = new URL("../app/favicon.ico", import.meta.url);
const appIcon = new URL("../app/icon.svg", import.meta.url);
const rootLayout = new URL("../app/layout.tsx", import.meta.url);
const packageScript = new URL("./package-installer.cjs", import.meta.url);

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
