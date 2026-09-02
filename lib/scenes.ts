import sceneBundle from "../bundled-resources/bundle.json";

export const SCENE_IDS = [
  "requirements",
  "design",
  "development",
  "integration",
  "testing",
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

export interface SceneDefinition {
  id: SceneId;
  label: string;
  labelEn: string;
  agentName: string;
  agentNameEn: string;
  description: string;
  descriptionEn: string;
  accent: string;
  instructions: string;
  skillPaths: readonly string[];
  mcpPaths: readonly string[];
}

const sceneIdSet = new Set<string>(SCENE_IDS);

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === "string" && sceneIdSet.has(value);
}

function validateSceneBundle(): readonly SceneDefinition[] {
  if (sceneBundle.schemaVersion !== 1) {
    throw new Error(`Unsupported scene bundle schema: ${sceneBundle.schemaVersion}`);
  }
  if (!isSceneId(sceneBundle.defaultSceneId)) {
    throw new Error(`Invalid default scene: ${sceneBundle.defaultSceneId}`);
  }

  const seen = new Set<string>();
  const scenes = sceneBundle.scenes.map((scene) => {
    if (!isSceneId(scene.id) || seen.has(scene.id)) {
      throw new Error(`Invalid or duplicate scene id: ${scene.id}`);
    }
    seen.add(scene.id);
    if (!scene.instructions || scene.skillPaths.length === 0 || !Array.isArray(scene.mcpPaths)) {
      throw new Error(`Scene resources are incomplete: ${scene.id}`);
    }
    return {
      ...scene,
      id: scene.id,
      skillPaths: [...scene.skillPaths],
      mcpPaths: [...scene.mcpPaths],
    };
  });

  if (SCENE_IDS.some((id) => !seen.has(id)) || scenes.length !== SCENE_IDS.length) {
    throw new Error("Scene bundle must define requirements, design, development, integration, and testing exactly once");
  }
  return scenes;
}

export const SCENES = validateSceneBundle();
export const DEFAULT_SCENE_ID = sceneBundle.defaultSceneId as SceneId;
export const SCENE_BUNDLE_VERSION = sceneBundle.bundleVersion;

const scenesById = new Map(SCENES.map((scene) => [scene.id, scene]));

export function getSceneDefinition(sceneId: SceneId): SceneDefinition {
  const scene = scenesById.get(sceneId);
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`);
  return scene;
}

export function getSceneLabel(scene: SceneDefinition, locale: string): string {
  return locale.toLowerCase().startsWith("zh") ? scene.label : scene.labelEn;
}

export function getSceneAgentName(scene: SceneDefinition, locale: string): string {
  return locale.toLowerCase().startsWith("zh") ? scene.agentName : scene.agentNameEn;
}

export function getSceneDescription(scene: SceneDefinition, locale: string): string {
  return locale.toLowerCase().startsWith("zh") ? scene.description : scene.descriptionEn;
}
