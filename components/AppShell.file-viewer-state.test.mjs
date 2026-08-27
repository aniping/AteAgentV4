import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{/* Mount one file viewer");
  const end = source.slice(start).search(/<\/div>\r?\n      <\/div>\r?\n    <\/div>/);
  assert.notEqual(start, -1, "workspace content comment not found");
  assert.notEqual(end, -1, "end of workspace content block not found");
  return source.slice(start, start + end);
}

test("only the active file viewer mounts while browser tabs retain their page state", () => {
  const block = fileContentBlock();
  assert.match(block, /activeWorkspaceTab\?\.kind === "file" \? \(/);
  assert.match(block, /activeWorkspaceTab\?\.kind === "browser" \? \(/);
  assert.match(block, /rightPanelOpen && workspaceTabs\.map\(\(tab\) => \{/);
  assert.match(block, /if \(tab\.kind !== "browser"\) return null/);
  assert.match(block, /hidden=\{tab\.id !== activeWorkspaceTabId\}/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
  assert.equal(block.match(/<BrowserViewer/g)?.length, 1);
});

test("the active viewer restores tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{activeWorkspaceTab\.id\}:\$\{activeWorkspaceTab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /initialState=\{activeWorkspaceTab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*activeWorkspaceTab\.id,\s*activeWorkspaceTab\.viewerRevision \?\? 0,/);
});

test("closing the file panel pauses the active viewer watcher", () => {
  assert.match(fileContentBlock(), /watchEnabled=\{rightPanelOpen\}/);
});
