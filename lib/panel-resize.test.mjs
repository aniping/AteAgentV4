import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./panel-resize.ts");
}

const config = {
  minWidth: 200,
  maxWidth: 480,
  collapseThreshold: 120,
};

test("limits the panel maximum while preserving the center workspace", async () => {
  const { getAvailablePanelMaxWidth } = await loadSubject();

  assert.equal(getAvailablePanelMaxWidth(1200, 400, 360, config), 440);
  assert.equal(getAvailablePanelMaxWidth(1600, 400, 360, config), 480);
});

test("keeps the configured minimum when the viewport is too narrow", async () => {
  const { getAvailablePanelMaxWidth } = await loadSubject();

  assert.equal(getAvailablePanelMaxWidth(700, 300, 360, config), 200);
});

test("allows dragging through the minimum into the collapse zone", async () => {
  const { clampPanelDragWidth } = await loadSubject();

  assert.equal(clampPanelDragWidth(-20, 440), 0);
  assert.equal(clampPanelDragWidth(80, 440), 80);
  assert.equal(clampPanelDragWidth(520, 440), 440);
});

test("collapses at the threshold and snaps partial collapse gestures open", async () => {
  const { settlePanelResize } = await loadSubject();

  assert.deepEqual(settlePanelResize(120, 440, config), { open: false });
  assert.deepEqual(settlePanelResize(160, 440, config), { open: true, width: 200 });
  assert.deepEqual(settlePanelResize(320, 440, config), { open: true, width: 320 });
});

test("sanitizes persisted widths", async () => {
  const { parseStoredPanelWidth } = await loadSubject();

  assert.equal(parseStoredPanelWidth("360", 260, config), 360);
  assert.equal(parseStoredPanelWidth("999", 260, config), 480);
  assert.equal(parseStoredPanelWidth("broken", 260, config), 260);
});
