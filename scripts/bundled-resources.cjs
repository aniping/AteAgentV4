"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SCENE_IDS = ["requirements", "design", "development", "integration", "testing"];

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveExistingResource(root, relativePath, kind) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`Invalid ${kind} resource path: ${String(relativePath)}`);
  }
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error(`${kind} resource escapes bundle root: ${relativePath}`);
  if (!fs.existsSync(candidate)) throw new Error(`${kind} resource is missing: ${relativePath}`);

  const realRoot = fs.realpathSync.native(root);
  const realCandidate = fs.realpathSync.native(candidate);
  if (!isWithin(realRoot, realCandidate)) {
    throw new Error(`${kind} resource resolves outside bundle root: ${relativePath}`);
  }
  return realCandidate;
}

function validateBundledStructure(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const manifestPath = path.join(root, "bundle.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Bundled resource manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported bundle schema: ${manifest.schemaVersion}`);

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const ids = scenes.map((scene) => scene?.id);
  if (
    ids.length !== REQUIRED_SCENE_IDS.length
    || REQUIRED_SCENE_IDS.some((id, index) => ids[index] !== id)
    || new Set(ids).size !== ids.length
  ) {
    throw new Error(`Bundle scenes must be exactly: ${REQUIRED_SCENE_IDS.join(", ")}`);
  }
  if (!REQUIRED_SCENE_IDS.includes(manifest.defaultSceneId)) {
    throw new Error(`Invalid default scene: ${manifest.defaultSceneId}`);
  }

  for (const scene of scenes) {
    const instructions = resolveExistingResource(root, scene.instructions, `${scene.id} instructions`);
    if (!fs.statSync(instructions).isFile() || path.basename(instructions) !== "AGENTS.md") {
      throw new Error(`${scene.id} instructions must point to AGENTS.md`);
    }
    if (!Array.isArray(scene.skillPaths) || scene.skillPaths.length === 0) {
      throw new Error(`${scene.id} must declare at least one Skill path`);
    }
    for (const skillPath of scene.skillPaths) {
      const resolvedSkillPath = resolveExistingResource(root, skillPath, `${scene.id} Skill`);
      if (!fs.statSync(resolvedSkillPath).isDirectory()) {
        throw new Error(`${scene.id} Skill path must be a directory: ${skillPath}`);
      }
    }
  }
  return manifest;
}

function formatDiagnostic(root, sceneId, diagnostic) {
  const diagnosticPath = diagnostic.path
    ? path.relative(root, diagnostic.path) || path.basename(diagnostic.path)
    : "unknown path";
  if (diagnostic.collision) {
    const winner = path.relative(root, diagnostic.collision.winnerPath);
    const loser = path.relative(root, diagnostic.collision.loserPath);
    return `[${sceneId}] collision: name "${diagnostic.collision.name}" is used by ${winner} and ${loser}`;
  }
  return `[${sceneId}] ${diagnostic.type}: ${diagnosticPath}: ${diagnostic.message}`;
}

function validateSkillResourceTree(root, realRoot, skillPath, realSkillRoot, sceneId) {
  const failures = [];
  let currentPath = root;
  for (const segment of path.relative(root, skillPath).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    let pathStats;
    try {
      pathStats = fs.lstatSync(currentPath);
    } catch (error) {
      failures.push(
        `[${sceneId}] error: ${path.relative(root, currentPath)} cannot be inspected: ${error.message}`,
      );
      return failures;
    }
    if (pathStats.isSymbolicLink()) {
      failures.push(
        `[${sceneId}] error: ${path.relative(root, currentPath)} is a filesystem link; links are not allowed`,
      );
      return failures;
    }
  }

  const pendingDirectories = [skillPath];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      failures.push(
        `[${sceneId}] error: ${path.relative(root, directory)} cannot be read: ${error.message}`,
      );
      continue;
    }

    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const relativeCandidate = path.relative(root, candidate);
      let stats;
      try {
        stats = fs.lstatSync(candidate);
      } catch (error) {
        failures.push(`[${sceneId}] error: ${relativeCandidate} cannot be inspected: ${error.message}`);
        continue;
      }
      if (stats.isSymbolicLink()) {
        failures.push(`[${sceneId}] error: ${relativeCandidate} is a filesystem link; links are not allowed`);
        continue;
      }

      let realCandidate;
      try {
        realCandidate = fs.realpathSync.native(candidate);
      } catch (error) {
        failures.push(`[${sceneId}] error: ${relativeCandidate} cannot be resolved: ${error.message}`);
        continue;
      }
      if (!isWithin(realRoot, realCandidate) || !isWithin(realSkillRoot, realCandidate)) {
        failures.push(`[${sceneId}] error: ${relativeCandidate} resolves outside its declared Skill path`);
        continue;
      }
      if (stats.isDirectory()) {
        pendingDirectories.push(candidate);
      } else if (!stats.isFile()) {
        failures.push(`[${sceneId}] error: ${relativeCandidate} is not a regular file or directory`);
      }
    }
  }
  return failures;
}

async function validateBundledSkills(bundleRoot, suppliedManifest) {
  const root = path.resolve(bundleRoot);
  const manifest = suppliedManifest ?? validateBundledStructure(root);
  const realRoot = fs.realpathSync.native(root);
  const { loadSkills } = await import("@earendil-works/pi-coding-agent");
  const summaries = [];
  const failures = [];

  for (const scene of manifest.scenes) {
    const skillPaths = scene.skillPaths.map((skillPath) => path.resolve(root, skillPath));
    const realSkillRoots = skillPaths.map((skillPath) => fs.realpathSync.native(skillPath));
    for (let index = 0; index < skillPaths.length; index += 1) {
      failures.push(
        ...validateSkillResourceTree(root, realRoot, skillPaths[index], realSkillRoots[index], scene.id),
      );
    }
    const result = loadSkills({
      cwd: root,
      agentDir: root,
      skillPaths,
      includeDefaults: false,
    });

    failures.push(...result.diagnostics.map((diagnostic) => formatDiagnostic(root, scene.id, diagnostic)));
    for (const skill of result.skills) {
      const realSkillPath = fs.realpathSync.native(skill.filePath);
      if (!isWithin(realRoot, realSkillPath) || !realSkillRoots.some((skillRoot) => isWithin(skillRoot, realSkillPath))) {
        failures.push(
          `[${scene.id}] error: ${path.relative(root, skill.filePath)} resolves outside its declared Skill paths`,
        );
      }
    }
    summaries.push({
      sceneId: scene.id,
      skillNames: result.skills.map((skill) => skill.name).sort(),
    });
  }

  if (failures.length > 0) {
    throw new Error(`Bundled Skill validation failed:\n- ${failures.join("\n- ")}`);
  }
  return summaries;
}

async function validateBundledResources(bundleRoot) {
  const manifest = validateBundledStructure(bundleRoot);
  await validateBundledSkills(bundleRoot, manifest);
  return manifest;
}

async function copyBundledResources(bundleRoot, appRoot) {
  await validateBundledResources(bundleRoot);
  const destination = path.join(appRoot, "bundled-resources");
  fs.cpSync(bundleRoot, destination, { recursive: true, force: true });
  await validateBundledResources(destination);
  return destination;
}

module.exports = {
  REQUIRED_SCENE_IDS,
  copyBundledResources,
  validateBundledResources,
  validateBundledSkills,
};
