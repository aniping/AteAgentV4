import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");

test("workspace tabs expose a roving keyboard-accessible tab pattern", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected=\{isActive\}/);
  assert.match(source, /aria-controls="workspace-panel-content"/);
  assert.match(source, /id=\{getWorkspaceTabDomId\(tab\.id\)\}/);
  assert.match(source, /tabIndex=\{isActive \? 0 : -1\}/);
  assert.match(source, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(source, /tabButtonRefs\.current\.get\(tabId\)\?\.focus\(\)/);
  assert.match(source, /else requestAnimationFrame\(\(\) => onTabsEmpty\?\.\(\)\)/);
});

test("the workspace panel can associate its tab panel and remove hidden controls from focus", async () => {
  const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(appShellSource, /inert=\{rightPanelOpen \? undefined : true\}/);
  assert.match(appShellSource, /aria-hidden=\{!rightPanelOpen\}/);
  assert.match(appShellSource, /id="workspace-panel-content"/);
  assert.match(appShellSource, /aria-labelledby=\{activeWorkspaceTab \? getWorkspaceTabDomId\(activeWorkspaceTab\.id\) : undefined\}/);
  assert.match(appShellSource, /requestAnimationFrame\(focusWorkspaceToggle\)/);
  assert.match(appShellSource, /querySelector<HTMLButtonElement>\('\[data-file-explorer-toggle="true"\]'\)/);
  assert.match(sidebarSource, /data-file-explorer-toggle="true"/);
  assert.match(sidebarSource, /aria-expanded=\{explorerOpen\}/);
});

test("file and browser tabs remain distinguishable and independently closable", () => {
  assert.match(source, /tab\.kind === "browser" \? <BrowserTabIcon \/> : getFileIcon/);
  assert.match(source, /aria-label=\{`\$\{t\("i18n\.close"\)\} \$\{tabLabel\}`\}/);
  assert.match(source, /className="workspace-tab-close"[\s\S]*?tabIndex=\{isActive \? 0 : -1\}|tabIndex=\{isActive \? 0 : -1\}[\s\S]*?className="workspace-tab-close"/);
  assert.match(source, /onAuxClick/);
});
