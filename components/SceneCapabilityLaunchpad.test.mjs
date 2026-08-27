import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SceneCapabilityLaunchpad } = await jiti.import("./SceneCapabilityLaunchpad.tsx");

test("renders all five engineering scenes and exposes the active scene", () => {
  const html = renderToStaticMarkup(
    React.createElement(SceneCapabilityLaunchpad, {
      activeSceneId: "integration",
      locale: "zh",
      onSceneChange() {},
    }),
  );

  for (const label of ["需求", "设计", "开发", "联调", "测试"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/>已选<\/span>/g) ?? []).length, 1);
  assert.match(html, /联调诊断 Agent/);
  assert.match(html, /交付 · 根因证据/);

  const englishHtml = renderToStaticMarkup(
    React.createElement(SceneCapabilityLaunchpad, {
      activeSceneId: "design",
      locale: "en",
      onSceneChange() {},
    }),
  );
  for (const label of ["Requirements", "Design", "Development", "Integration", "Testing"]) {
    assert.match(englishHtml, new RegExp(`>${label}<`));
  }
  assert.match(englishHtml, /Engineering Design Agent/);
  assert.equal((englishHtml.match(/>Selected<\/span>/g) ?? []).length, 1);
});

test("uses the capability launchpad as the default new-session experience", async () => {
  const [appShellSource, chatWindowSource, proxySource] = await Promise.all([
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);

  const retiredShellProp = ["scene", "Capability", "Preview"].join("");
  const retiredChatProp = ["show", "Scene", "Capability", "Launchpad"].join("");
  assert.equal(appShellSource.includes(retiredShellProp), false);
  assert.equal(chatWindowSource.includes(retiredChatProp), false);
  assert.match(chatWindowSource, /const useCapabilityLaunchpad = !isMobile/);
  assert.match(chatWindowSource, /wideLayout=\{useCapabilityLaunchpad && isEmptyNew\}/);
  assert.doesNotMatch(proxySource, /\/prototype/);
});
