"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const crypto = require("node:crypto");
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

function assertNoFilesystemLinks(root, target, label) {
  const relative = path.relative(root, target);
  if (!isWithin(root, target)) throw new Error(`${label} escapes bundle root: ${target}`);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains a filesystem link: ${path.relative(root, current)}`);
    }
  }
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
    if (!Array.isArray(scene.mcpPaths)) {
      throw new Error(`${scene.id} must declare MCP paths`);
    }
    for (const mcpPath of scene.mcpPaths) {
      const resolvedMcpPath = resolveExistingResource(root, mcpPath, `${scene.id} MCP`);
      if (!fs.statSync(resolvedMcpPath).isDirectory()) {
        throw new Error(`${scene.id} MCP path must be a directory: ${mcpPath}`);
      }
    }
  }
  return manifest;
}

function normalizedRelativeFilePath(rawPath, label) {
  if (
    typeof rawPath !== "string"
    || !rawPath
    || rawPath.includes("\0")
    || rawPath.includes("\\")
    || rawPath.startsWith("/")
    || /^[A-Za-z]:/.test(rawPath)
  ) {
    throw new Error(`${label} must be a safe relative path: ${String(rawPath)}`);
  }
  const segments = rawPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} escapes its MCP integration root: ${rawPath}`);
  }
  return rawPath;
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

function listBundledMcpFiles(integrationRoot, realBundleRoot, sceneId) {
  const files = [];
  const pending = [integrationRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const stats = fs.lstatSync(candidate);
      const relative = path.relative(integrationRoot, candidate).split(path.sep).join("/");
      if (stats.isSymbolicLink()) {
        throw new Error(`[${sceneId}] bundled MCP resource is a filesystem link: ${relative}`);
      }
      const realCandidate = fs.realpathSync.native(candidate);
      if (!isWithin(realBundleRoot, realCandidate) || !isWithin(integrationRoot, realCandidate)) {
        throw new Error(`[${sceneId}] bundled MCP resource resolves outside its root: ${relative}`);
      }
      if (stats.isDirectory()) pending.push(candidate);
      else if (stats.isFile()) files.push(relative);
      else throw new Error(`[${sceneId}] bundled MCP resource is not a regular file: ${relative}`);
    }
  }
  return files.sort();
}

function requireMcpString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function validateMcpManifest(manifest, manifestPath, integrationRoot) {
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported bundled MCP manifest schema: ${manifestPath}`);
  const id = requireMcpString(manifest.id, `MCP id in ${manifestPath}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id !== path.basename(integrationRoot)) {
    throw new Error(`MCP id must match its integration directory: ${manifestPath}`);
  }
  const version = requireMcpString(manifest.version, `MCP version in ${manifestPath}`);
  const platform = requireMcpString(manifest.platform, `MCP platform in ${manifestPath}`);
  const arch = requireMcpString(manifest.arch, `MCP architecture in ${manifestPath}`);
  if (!manifest.mcp || typeof manifest.mcp !== "object" || Array.isArray(manifest.mcp)) {
    throw new Error(`MCP definition is missing from ${manifestPath}`);
  }
  const serverName = requireMcpString(manifest.mcp.serverName, `MCP server name in ${manifestPath}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(serverName)) {
    throw new Error(`Invalid MCP server name in ${manifestPath}: ${serverName}`);
  }
  const executable = normalizedRelativeFilePath(manifest.mcp.executable, "MCP executable path");
  const lifecycle = manifest.mcp.lifecycle ?? "lazy";
  if (!["lazy", "eager", "keep-alive"].includes(lifecycle)) {
    throw new Error(`Invalid MCP lifecycle in ${manifestPath}: ${String(lifecycle)}`);
  }
  if (manifest.mcp.args !== undefined && (
    !Array.isArray(manifest.mcp.args)
    || !manifest.mcp.args.every((argument) => typeof argument === "string")
  )) {
    throw new Error(`MCP args must be an array of strings: ${manifestPath}`);
  }
  if (manifest.mcp.env !== undefined && (
    !manifest.mcp.env
    || typeof manifest.mcp.env !== "object"
    || Array.isArray(manifest.mcp.env)
    || !Object.entries(manifest.mcp.env).every(([key, value]) => key && typeof value === "string")
  )) {
    throw new Error(`MCP env must be an object of string values: ${manifestPath}`);
  }
  return { id, version, platform, arch, serverName, executable };
}

function validateMcpChecksums(integrationRoot, files) {
  const checksumPath = path.join(integrationRoot, "SHA256SUMS.json");
  if (!files.includes("SHA256SUMS.json")) throw new Error(`Bundled MCP checksum manifest is missing: ${checksumPath}`);
  const checksumManifest = readJsonObject(checksumPath, `Bundled MCP checksum manifest ${checksumPath}`);
  if (
    checksumManifest.schemaVersion !== 1
    || !checksumManifest.files
    || typeof checksumManifest.files !== "object"
    || Array.isArray(checksumManifest.files)
  ) {
    throw new Error(`Bundled MCP checksum manifest must use schemaVersion 1: ${checksumPath}`);
  }
  const declared = checksumManifest.files;
  const expected = files.filter((file) => file !== "SHA256SUMS.json");
  const declaredPaths = Object.keys(declared).map((file) => normalizedRelativeFilePath(file, "MCP checksum path")).sort();
  if (declaredPaths.length !== expected.length || declaredPaths.some((file, index) => file !== expected[index])) {
    throw new Error(`Bundled MCP checksum entries do not match packaged files: ${checksumPath}`);
  }
  for (const relativePath of expected) {
    const expectedHash = declared[relativePath];
    if (typeof expectedHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedHash)) {
      throw new Error(`Invalid SHA-256 for bundled MCP file ${relativePath}`);
    }
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(integrationRoot, ...relativePath.split("/"))))
      .digest("hex");
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`Bundled MCP SHA-256 mismatch: ${relativePath}`);
    }
  }
}

function validatePeArchitecture(executablePath, arch) {
  const executable = fs.readFileSync(executablePath);
  if (executable.length < 0x40 || executable.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`Bundled MCP runtime is not a Windows PE executable: ${executablePath}`);
  }
  const peOffset = executable.readUInt32LE(0x3c);
  const coffHeaderEnd = peOffset + 24;
  if (coffHeaderEnd > executable.length || executable.toString("binary", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error(`Bundled MCP runtime has an invalid PE header: ${executablePath}`);
  }
  const expectedMachine = arch === "x64" ? 0x8664 : arch === "arm64" ? 0xaa64 : undefined;
  if (expectedMachine === undefined) throw new Error(`Unsupported bundled MCP architecture: ${arch}`);
  const actualMachine = executable.readUInt16LE(peOffset + 4);
  if (actualMachine !== expectedMachine) {
    throw new Error(
      `Bundled MCP runtime architecture mismatch for ${executablePath}: expected ${arch}, PE machine 0x${actualMachine.toString(16)}`,
    );
  }
  const sectionCount = executable.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = executable.readUInt16LE(peOffset + 20);
  const characteristics = executable.readUInt16LE(peOffset + 22);
  const optionalHeaderOffset = peOffset + 24;
  const sectionTableEnd = optionalHeaderOffset + optionalHeaderSize + sectionCount * 40;
  if (
    sectionCount === 0
    || sectionCount > 96
    || optionalHeaderSize < 112
    || sectionTableEnd > executable.length
    || executable.readUInt16LE(optionalHeaderOffset) !== 0x20b
    || (characteristics & 0x0002) === 0
  ) {
    throw new Error(`Bundled MCP runtime is not a valid executable PE32+ image: ${executablePath}`);
  }
}

function validateBundledMcpResources(bundleRoot, manifest, options = {}) {
  const root = path.resolve(bundleRoot);
  const realRoot = fs.realpathSync.native(root);
  const summaries = [];
  for (const scene of manifest.scenes) {
    const serverNames = new Set();
    for (const mcpPath of scene.mcpPaths) {
      const declaredMcpRoot = path.resolve(root, mcpPath);
      assertNoFilesystemLinks(root, declaredMcpRoot, `[${scene.id}] bundled MCP root`);
      const mcpRoot = resolveExistingResource(root, mcpPath, `${scene.id} MCP`);
      for (const entry of fs.readdirSync(mcpRoot, { withFileTypes: true })) {
        const declaredIntegrationRoot = path.join(declaredMcpRoot, entry.name);
        assertNoFilesystemLinks(root, declaredIntegrationRoot, `[${scene.id}] bundled MCP integration`);
        if (!entry.isDirectory() || fs.lstatSync(declaredIntegrationRoot).isSymbolicLink()) {
          throw new Error(`[${scene.id}] MCP roots may contain only integration directories: ${entry.name}`);
        }
        const integrationRoot = fs.realpathSync.native(declaredIntegrationRoot);
        if (!isWithin(realRoot, integrationRoot) || !isWithin(mcpRoot, integrationRoot)) {
          throw new Error(`[${scene.id}] bundled MCP integration resolves outside its root: ${entry.name}`);
        }
        const files = listBundledMcpFiles(integrationRoot, realRoot, scene.id);
        if (!files.includes("integration.json")) {
          throw new Error(`[${scene.id}] bundled MCP manifest is missing: ${entry.name}/integration.json`);
        }
        const manifestPath = path.join(integrationRoot, "integration.json");
        const parsed = validateMcpManifest(readJsonObject(manifestPath, `Bundled MCP manifest ${manifestPath}`), manifestPath, integrationRoot);
        if (serverNames.has(parsed.serverName)) {
          throw new Error(`[${scene.id}] duplicate bundled MCP server name: ${parsed.serverName}`);
        }
        serverNames.add(parsed.serverName);
        const executablePath = path.resolve(integrationRoot, ...parsed.executable.split("/"));
        if (!isWithin(integrationRoot, executablePath) || !fs.existsSync(executablePath)) {
          throw new Error(`Bundled MCP runtime is missing: ${parsed.executable}`);
        }
        validateMcpChecksums(integrationRoot, files);
        validatePeArchitecture(executablePath, parsed.arch);
        if (options.targetPlatform && parsed.platform !== options.targetPlatform) {
          throw new Error(`Bundled MCP ${parsed.id} targets ${parsed.platform}, not ${options.targetPlatform}`);
        }
        if (options.targetArch && parsed.arch !== options.targetArch) {
          throw new Error(`Bundled MCP ${parsed.id} targets ${parsed.arch}, not ${options.targetArch}`);
        }
        summaries.push({ sceneId: scene.id, ...parsed });
      }
    }
  }
  return summaries;
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

async function validateBundledResources(bundleRoot, options = {}) {
  const manifest = validateBundledStructure(bundleRoot);
  await validateBundledSkills(bundleRoot, manifest);
  validateBundledMcpResources(bundleRoot, manifest, options);
  return manifest;
}

async function copyBundledResources(bundleRoot, appRoot, options = {}) {
  await validateBundledResources(bundleRoot, options);
  const destination = path.join(appRoot, "bundled-resources");
  fs.cpSync(bundleRoot, destination, { recursive: true, force: true });
  await validateBundledResources(destination, options);
  return destination;
}

module.exports = {
  REQUIRED_SCENE_IDS,
  copyBundledResources,
  validateBundledMcpResources,
  validateBundledResources,
  validateBundledSkills,
};

if (require.main === module) {
  validateBundledResources(path.resolve(__dirname, "..", "bundled-resources"))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
