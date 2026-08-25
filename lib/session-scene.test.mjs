import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createSceneBindingData,
  getSceneIdFromEntries,
  SCENE_BINDING_CUSTOM_TYPE,
} = await jiti.import("./session-scene.ts");

test("scene binding round-trips through a namespaced custom entry", () => {
  const entries = [{
    type: "custom",
    customType: SCENE_BINDING_CUSTOM_TYPE,
    data: createSceneBindingData("integration"),
  }];
  assert.equal(getSceneIdFromEntries(entries), "integration");
});

test("legacy and malformed scene metadata remain unclassified", () => {
  assert.equal(getSceneIdFromEntries([]), undefined);
  assert.equal(getSceneIdFromEntries([{ type: "message" }]), undefined);
  assert.equal(getSceneIdFromEntries([{
    type: "custom",
    customType: SCENE_BINDING_CUSTOM_TYPE,
    data: { schemaVersion: 1, sceneId: "debug", bundleVersion: "1" },
  }]), undefined);
  assert.equal(getSceneIdFromEntries([{
    type: "custom",
    customType: SCENE_BINDING_CUSTOM_TYPE,
    data: { schemaVersion: 2, sceneId: "testing", bundleVersion: "1" },
  }]), undefined);
});
