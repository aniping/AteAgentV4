import { isSceneId, SCENE_BUNDLE_VERSION, type SceneId } from "./scenes";

export const SCENE_BINDING_CUSTOM_TYPE = "wireless-ate-agent/scene";
export const SCENE_BINDING_SCHEMA_VERSION = 1;

export interface SceneBindingData {
  schemaVersion: typeof SCENE_BINDING_SCHEMA_VERSION;
  sceneId: SceneId;
  bundleVersion: string;
}

export function createSceneBindingData(sceneId: SceneId): SceneBindingData {
  return { schemaVersion: SCENE_BINDING_SCHEMA_VERSION, sceneId, bundleVersion: SCENE_BUNDLE_VERSION };
}

export function getSceneIdFromEntries(entries: readonly unknown[]): SceneId | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      type?: unknown;
      customType?: unknown;
      data?: { schemaVersion?: unknown; sceneId?: unknown; bundleVersion?: unknown };
    };
    if (candidate.type !== "custom" || candidate.customType !== SCENE_BINDING_CUSTOM_TYPE) continue;
    if (candidate.data?.schemaVersion !== SCENE_BINDING_SCHEMA_VERSION) continue;
    if (typeof candidate.data.bundleVersion !== "string" || !candidate.data.bundleVersion) continue;
    if (isSceneId(candidate.data.sceneId)) return candidate.data.sceneId;
  }
  return undefined;
}
