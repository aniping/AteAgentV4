import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_SCENE_ID,
  getSceneDefinition,
  isSceneId,
  SCENES,
  SCENE_IDS,
} = await jiti.import("./scenes.ts");
const { getSceneResourceConfig, isBundledSceneSkillPath } = await jiti.import("./scene-resources.ts");

test("scene registry defines the five stable workflow scenes exactly once", () => {
  assert.deepEqual([...SCENE_IDS], ["requirements", "design", "development", "integration", "testing"]);
  assert.deepEqual(SCENES.map((scene) => scene.id), [...SCENE_IDS]);
  assert.equal(new Set(SCENES.map((scene) => scene.id)).size, 5);
  assert.equal(DEFAULT_SCENE_ID, "requirements");
  assert.equal(isSceneId("design"), true);
  assert.equal(isSceneId("unclassified"), false);
});

test("every scene resolves its Agent instructions and isolated Skill roots", () => {
  for (const scene of SCENES) {
    const resources = getSceneResourceConfig(scene.id);
    assert.match(resources.instructionsPath, /AGENTS\.md$/);
    assert.match(resources.instructionsContent, new RegExp(getSceneDefinition(scene.id).agentName));
    assert.equal(resources.skillPaths.length, 1);
    assert.match(resources.skillPaths[0], new RegExp(`[\\\\/]${scene.id}[\\\\/]skills$`));
  }
  assert.equal(new Set(SCENES.flatMap((scene) => getSceneResourceConfig(scene.id).skillPaths)).size, 5);
});

test("scene Skill roots identify only their own bundled files", () => {
  const design = getSceneResourceConfig("design");
  assert.equal(isBundledSceneSkillPath(`${design.skillPaths[0]}/rf-budget/SKILL.md`, design.skillPaths), true);
  assert.equal(
    isBundledSceneSkillPath(getSceneResourceConfig("testing").skillPaths[0], design.skillPaths),
    false,
  );
});
