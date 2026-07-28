import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AddSkillPanel, SkillDetail } = await jiti.import("./SkillsConfig.tsx");
const { AddPluginPanel } = await jiti.import("./PluginsConfig.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function withI18n(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("skill installation links to the skills.sh catalog", () => {
  const html = withI18n(React.createElement(AddSkillPanel, {
    cwd: "C:/project",
    installedPackages: { global: new Set(), project: new Set() },
    projectResourcesLoaded: true,
    onInstalled() {},
  }));

  assert.match(html, /Search <a href="https:\/\/skills\.sh\/" target="_blank" rel="noreferrer"[^>]*>skills\.sh<\/a> to discover and install skills/);
});

test("skill installation offers a generic ZIP upload", () => {
  const html = withI18n(React.createElement(AddSkillPanel, {
    cwd: "C:/project",
    installedPackages: { global: new Set(), project: new Set() },
    projectResourcesLoaded: true,
    onInstalled() {},
  }));

  assert.match(html, /Install from ZIP/);
  assert.match(html, /<input[^>]+type="file"[^>]+accept="\.zip,application\/zip"/);
  assert.match(html, /exactly one SKILL\.md/);
});

test("ZIP-installed skills offer a complete uninstall action", () => {
  const html = withI18n(React.createElement(SkillDetail, {
    skill: {
      name: "portable",
      description: "Portable skill",
      filePath: "C:/project/.pi/skills/portable/SKILL.md",
      baseDir: "C:/project/.pi/skills/portable",
      disableModelInvocation: false,
      sourceInfo: { source: "project", scope: "project" },
      archiveInstall: { kind: "skill", scope: "project" },
    },
    cwd: "C:/project",
    onToggle() {},
    toggling: false,
    saveError: null,
    checkingUpdate: false,
    updating: false,
    updateError: null,
    onCheckUpdate() {},
    onUpdate() {},
    uninstalling: false,
    uninstallError: null,
    onUninstall() {},
  }));

  assert.match(html, />Uninstall<\/button>/);
});

test("plugin installation links to the filtered Pi extension catalog", () => {
  const html = withI18n(React.createElement(AddPluginPanel, {
    cwd: "C:/project",
    source: "",
    scope: "global",
    projectResourcesLoaded: true,
    busy: false,
    actionError: null,
    onSourceChange() {},
    onScopeChange() {},
    onInstall() {},
  }));

  assert.match(html, /Browse <a href="https:\/\/pi\.dev\/packages\?type=extension" target="_blank" rel="noreferrer"[^>]*>pi\.dev\/packages<\/a> to discover and install Pi plugins/);
});
