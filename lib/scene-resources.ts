import { existsSync, readFileSync, realpathSync } from "fs";
import { resolve, sep } from "path";
import { isPathWithinRoots } from "./path-security";
import { getSceneDefinition, type SceneId } from "./scenes";

export interface SceneResourceConfig {
  instructionsPath: string;
  instructionsContent: string;
  skillPaths: string[];
}

export function getBundledResourcesRoot(): string {
  return resolve(process.cwd(), "bundled-resources");
}

function resolveBundledPath(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(rootPrefix)) {
    throw new Error(`Bundled resource escapes its root: ${relativePath}`);
  }
  if (!existsSync(target)) {
    throw new Error(`Bundled scene resource is missing: ${target}`);
  }
  const realRoot = realpathSync.native(root);
  const realTarget = realpathSync.native(target);
  const realRootPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (realTarget !== realRoot && !realTarget.startsWith(realRootPrefix)) {
    throw new Error(`Bundled resource resolves outside its root: ${relativePath}`);
  }
  return realTarget;
}

export function getSceneResourceConfig(sceneId: SceneId): SceneResourceConfig {
  const scene = getSceneDefinition(sceneId);
  const root = getBundledResourcesRoot();
  const instructionsPath = resolveBundledPath(root, scene.instructions);
  return {
    instructionsPath,
    instructionsContent: readFileSync(instructionsPath, "utf8"),
    skillPaths: scene.skillPaths.map((skillPath) => resolveBundledPath(root, skillPath)),
  };
}

export function isBundledSceneSkillPath(filePath: string, skillPaths: readonly string[]): boolean {
  return isPathWithinRoots(filePath, new Set(skillPaths));
}
