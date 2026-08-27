import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const [launchpadSource, sidebarSource] = await Promise.all([
  readFile(new URL("./SceneCapabilityLaunchpad.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
]);
const stylesheet = postcss.parse(css);

function declarationsFor(selector, query, atRuleName) {
  const declarations = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;
    const atRule = rule.parent?.type === "atrule"
      ? rule.parent
      : undefined;
    if (atRule?.params !== query) return;
    if (atRuleName !== undefined && atRule?.name !== atRuleName) return;
    declarations.push(Object.fromEntries(rule.nodes
      .filter((node) => node.type === "decl")
      .map((node) => [node.prop, node.value])));
  });
  return declarations;
}

test("respects reduced motion while keeping a static brand highlight", () => {
  const reducedMotionRules = declarationsFor(
    ".ate-brand-hero--animated",
    "(prefers-reduced-motion: reduce)",
    "media",
  );

  assert.equal(reducedMotionRules.length, 1);
  assert.equal(reducedMotionRules[0].animation, "none");
  assert.match(reducedMotionRules[0].filter ?? "", /saturate\(/);
  assert.equal(reducedMotionRules[0]["will-change"], "auto");
});

test("scene selectors expose distinct hover, press, focus, and selected treatments", () => {
  for (const selector of [
    ".scene-capability-card:active",
    ".scene-capability-card:focus-visible",
    ".scene-capability-card--active",
    ".sidebar-scene-button:active",
    ".sidebar-scene-button:focus-visible",
    ".sidebar-scene-button--active",
  ]) {
    assert.ok(declarationsFor(selector).length > 0, `missing ${selector}`);
  }

  for (const selector of [
    ".scene-capability-card:focus-visible",
    ".sidebar-scene-button:focus-visible",
  ]) {
    const [focusRule] = declarationsFor(selector);
    assert.match(
      focusRule.outline ?? "",
      /color-mix\(in srgb, var\(--.+-accent\) 42%, var\(--text\)\)/,
      `${selector} must keep its scene color while meeting focus contrast`,
    );
  }

  for (const selector of [
    ".scene-capability-card:not(.scene-capability-card--active):hover",
    ".sidebar-scene-button:not(.sidebar-scene-button--active):hover",
  ]) {
    assert.ok(
      declarationsFor(selector, "(hover: hover) and (pointer: fine)", "media").length > 0,
      `missing pointer-aware ${selector}`,
    );
  }

  assert.match(launchpadSource, /aria-pressed=\{active\}/);
  assert.match(launchpadSource, /scene-capability-current/);
  assert.match(launchpadSource, /scene-capability-select-hint/);
  assert.match(sidebarSource, /sidebar-scene-button--active/);
  assert.match(sidebarSource, /sidebar-scene-selected-mark/);
  assert.match(sidebarSource, /const active = !showUnclassified && scene\.id === activeSceneId/);
  assert.match(
    sidebarSource,
    /if \(!selectedSessionId\) \{\s*setShowUnclassified\(false\);\s*return;[\s\S]*?\}, \[activeSceneId, allSessions, selectedSessionId\]\);/,
  );
  assert.match(
    sidebarSource,
    /const handleNewSession = useCallback\(\(\) => \{\s*if \(!selectedCwd\) return;\s*setShowUnclassified\(false\);/,
  );

  for (const selector of [
    ".scene-capability-card--active:hover:not(:active)",
    ".sidebar-scene-button--active:hover:not(:active)",
  ]) {
    const [selectedHover] = declarationsFor(
      selector,
      "(hover: hover) and (pointer: fine)",
      "media",
    );
    assert.ok(selectedHover.background, `${selector} must retain its selected surface`);
    assert.ok(selectedHover["border-color"], `${selector} must retain its selected border`);
    assert.ok(selectedHover["box-shadow"], `${selector} must retain its selected depth`);
  }

  const [selectedFocusRail] = declarationsFor(
    ".scene-capability-card--active:focus-visible::after",
  );
  assert.equal(selectedFocusRail.opacity, "1");
  assert.match(selectedFocusRail.transform ?? "", /scaleX\(1\)/);
});

test("the capability selector stays readable beside an open workspace", () => {
  const compactSidebarMark = declarationsFor(
    ".sidebar-scene-selected-mark",
    "(max-width: 215px)",
    "container",
  );
  assert.equal(compactSidebarMark.at(-1)?.display, "none");

  const compactDeck = declarationsFor(
    ".scene-capability-deck",
    "(max-width: 700px)",
    "container",
  );
  const compactCard = declarationsFor(
    ".scene-capability-card",
    "(max-width: 700px)",
    "container",
  );
  const compactDescription = declarationsFor(
    ".scene-capability-card p",
    "(max-width: 700px)",
    "container",
  );
  const compactOutput = declarationsFor(
    ".scene-capability-output",
    "(max-width: 700px)",
    "container",
  );
  const compactGroups = declarationsFor(
    ".scene-capability-groups",
    "(max-width: 700px)",
    "container",
  );
  const compactDetail = declarationsFor(
    ".scene-capability-detail",
    "(max-width: 700px)",
    "container",
  );
  const compactVersion = declarationsFor(
    ".scene-capability-version",
    "(max-width: 700px)",
    "container",
  );
  const [fullDetail] = declarationsFor(".scene-capability-detail");

  assert.equal(fullDetail.display, "grid");
  assert.equal(compactDeck.at(-1)?.["grid-template-columns"], "repeat(5, minmax(0, 1fr))");
  assert.equal(compactCard.at(-1)?.["min-height"], "48px");
  assert.equal(compactCard.at(-1)?.["justify-self"], "stretch");
  assert.equal(compactDescription.at(-1)?.display, "none");
  assert.equal(compactOutput.at(-1)?.display, "none");
  assert.equal(compactGroups.at(-1)?.display, "none");
  assert.equal(compactDetail.at(-1)?.["min-height"], "0");
  assert.equal(compactVersion.at(-1)?.display, "none");

  const extraNarrowDeck = declarationsFor(
    ".scene-capability-deck",
    "(max-width: 300px)",
    "container",
  );
  const centeredFourthCard = declarationsFor(
    ".scene-capability-card:nth-child(4)",
    "(max-width: 300px)",
    "container",
  );
  const extraNarrowBrand = declarationsFor(
    ".scene-capability-brand .ate-brand-title",
    "(max-width: 300px)",
    "container",
  );
  assert.equal(extraNarrowDeck.at(-1)?.["grid-template-columns"], "repeat(6, minmax(0, 1fr))");
  assert.equal(centeredFourthCard.at(-1)?.["grid-column"], "2 / span 2");
  assert.equal(extraNarrowBrand.at(-1)?.display, "none");

  assert.match(launchpadSource, /scene-capability-card-label-compact/);
  assert.match(launchpadSource, /aria-label=\{getSceneLabel\(scene, locale\)\}/);
});
