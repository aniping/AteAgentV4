import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { basename, resolve, sep } from "path";
import type { SceneMcpServerConfig } from "./mcp-adapter";
import { isPathWithinRoots } from "./path-security";
import { getSceneDefinition, type SceneId } from "./scenes";

export interface SceneResourceConfig {
  instructionsPath: string;
  instructionsContent: string;
  skillPaths: string[];
  mcpServers: SceneMcpServerConfig[];
}

interface BundledMcpManifest {
  schemaVersion?: unknown;
  id?: unknown;
  version?: unknown;
  platform?: unknown;
  arch?: unknown;
  mcp?: unknown;
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function parseEnvironment(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object of string values`);
  }
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key.length > 0 && typeof item === "string")) {
    throw new Error(`${label} must be an object of string values`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function loadBundledMcpServer(integrationRoot: string): SceneMcpServerConfig {
  const manifestPath = resolveBundledPath(integrationRoot, "integration.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BundledMcpManifest;
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported bundled MCP schema: ${manifestPath}`);
  const id = requireString(manifest.id, `Bundled MCP id in ${manifestPath}`);
  if (basename(integrationRoot) !== id) {
    throw new Error(`Bundled MCP id must match its directory name: ${manifestPath}`);
  }
  const version = requireString(manifest.version, `Bundled MCP version in ${manifestPath}`);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Bundled MCP ${id} requires ${String(manifest.platform)}/${String(manifest.arch)}; current runtime is ${process.platform}/${process.arch}`,
    );
  }
  if (!manifest.mcp || typeof manifest.mcp !== "object" || Array.isArray(manifest.mcp)) {
    throw new Error(`Bundled MCP definition is missing: ${manifestPath}`);
  }
  const mcp = manifest.mcp as Record<string, unknown>;
  const serverName = requireString(mcp.serverName, `Bundled MCP server name in ${manifestPath}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(serverName)) {
    throw new Error(`Invalid bundled MCP server name: ${serverName}`);
  }
  const executable = requireString(mcp.executable, `Bundled MCP executable in ${manifestPath}`);
  const command = resolveBundledPath(integrationRoot, executable);
  if (!statSync(command).isFile()) throw new Error(`Bundled MCP executable is not a file: ${command}`);
  const lifecycle = mcp.lifecycle ?? "lazy";
  if (lifecycle !== "lazy" && lifecycle !== "eager" && lifecycle !== "keep-alive") {
    throw new Error(`Invalid bundled MCP lifecycle in ${manifestPath}: ${String(lifecycle)}`);
  }
  const env = parseEnvironment(mcp.env, `Bundled MCP env in ${manifestPath}`);
  return {
    id,
    version,
    serverName,
    command,
    args: parseStringArray(mcp.args, `Bundled MCP args in ${manifestPath}`),
    ...(env ? { env } : {}),
    lifecycle,
  };
}

function loadSceneMcpServers(bundleRoot: string, mcpPaths: readonly string[]): SceneMcpServerConfig[] {
  const servers: SceneMcpServerConfig[] = [];
  const names = new Set<string>();
  for (const mcpPath of mcpPaths) {
    const mcpRoot = resolveBundledPath(bundleRoot, mcpPath);
    if (!statSync(mcpRoot).isDirectory()) throw new Error(`Bundled MCP path is not a directory: ${mcpRoot}`);
    for (const entry of readdirSync(mcpRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) throw new Error(`Bundled MCP roots may contain only integration directories: ${entry.name}`);
      const server = loadBundledMcpServer(resolveBundledPath(mcpRoot, entry.name));
      if (names.has(server.serverName)) throw new Error(`Duplicate bundled MCP server name: ${server.serverName}`);
      names.add(server.serverName);
      servers.push(server);
    }
  }
  return servers;
}

export function getSceneResourceConfig(sceneId: SceneId): SceneResourceConfig {
  const scene = getSceneDefinition(sceneId);
  const root = getBundledResourcesRoot();
  const instructionsPath = resolveBundledPath(root, scene.instructions);
  return {
    instructionsPath,
    instructionsContent: readFileSync(instructionsPath, "utf8"),
    skillPaths: scene.skillPaths.map((skillPath) => resolveBundledPath(root, skillPath)),
    mcpServers: loadSceneMcpServers(root, scene.mcpPaths),
  };
}

export function isBundledSceneSkillPath(filePath: string, skillPaths: readonly string[]): boolean {
  return isPathWithinRoots(filePath, new Set(skillPaths));
}
