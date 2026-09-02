import type {
  ExtensionFactory,
  InlineExtension,
  LoadExtensionsResult,
  PackageManager,
} from "@earendil-works/pi-coding-agent";
import type { McpConfig, ServerEntry } from "pi-mcp-adapter/types";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { PluginPackageInfo } from "./api-types";

const MCP_ADAPTER_SOURCE = "npm:pi-mcp-adapter";
const SCENE_MCP_ADAPTER_PATH = "<inline:pi-mcp-adapter>";

interface BundledMcpAdapterResources {
  extensionPaths: string[];
  skillPaths: string[];
  extensionFactories?: InlineExtension[];
}

interface PrepareBundledMcpAdapterOptions {
  cwd: string;
  sceneMcpServers: readonly SceneMcpServerConfig[];
  loadAmbientConfig?: (cwd: string) => McpConfig;
}

interface McpAdapterRuntimeModule {
  createMcpAdapter(options: { config: McpConfig }): ExtensionFactory;
}

interface McpAdapterConfigModule {
  loadMcpConfig(overridePath?: string, cwd?: string): McpConfig;
}

interface McpAdapterRuntimeModules {
  runtime: McpAdapterRuntimeModule;
  config: McpAdapterConfigModule;
}

let mcpAdapterRuntimeModules: Promise<McpAdapterRuntimeModules> | undefined;

export interface SceneMcpServerConfig {
  id: string;
  version: string;
  serverName: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  lifecycle: "lazy" | "eager" | "keep-alive";
}

export function mergeSceneMcpServers(
  ambient: McpConfig,
  sceneServers: readonly SceneMcpServerConfig[],
): McpConfig {
  const bundledServers = Object.fromEntries(sceneServers.map((server) => {
    const definition: ServerEntry = {
      command: server.command,
      lifecycle: server.lifecycle,
      directTools: false,
      ...(server.args.length > 0 ? { args: [...server.args] } : {}),
      ...(server.env && Object.keys(server.env).length > 0 ? { env: { ...server.env } } : {}),
    };
    return [server.serverName, definition];
  }));
  return {
    ...ambient,
    settings: {
      ...ambient.settings,
      disableProxyTool: false,
    },
    mcpServers: {
      ...ambient.mcpServers,
      ...bundledServers,
    },
  };
}

function registersMcpAdapterSurface(extension: LoadExtensionsResult["extensions"][number]): boolean {
  return extension.tools.has("mcp")
    || extension.tools.has("mcpScript")
    || extension.commands.has("mcp")
    || extension.commands.has("mcp-auth");
}

export function preferBundledSceneMcpAdapter(base: LoadExtensionsResult): LoadExtensionsResult {
  const bundled = base.extensions.find((extension) => extension.path === SCENE_MCP_ADAPTER_PATH);
  if (!bundled) return base;

  const removedPaths = new Set(
    base.extensions
      .filter((extension) => extension !== bundled && registersMcpAdapterSurface(extension))
      .map((extension) => extension.path),
  );
  return {
    ...base,
    extensions: base.extensions.filter((extension) => !removedPaths.has(extension.path)),
    errors: base.errors.filter((error) => {
      if (removedPaths.has(error.path)) return false;
      return !(
        error.path === SCENE_MCP_ADAPTER_PATH
        && /^(?:Tool "(?:mcp|mcpScript)"|Flag "--mcp-config") conflicts with /.test(error.error)
      );
    }),
  };
}

function loadMcpAdapterRuntimeModules(): Promise<McpAdapterRuntimeModules> {
  if (mcpAdapterRuntimeModules) return mcpAdapterRuntimeModules;
  const packageRoot = join(process.cwd(), "node_modules", "pi-mcp-adapter");
  const jiti = createJiti(join(process.cwd(), "package.json"));
  mcpAdapterRuntimeModules = Promise.all([
    jiti.import<McpAdapterRuntimeModule>(join(packageRoot, "index.ts")),
    jiti.import<McpAdapterConfigModule>(join(packageRoot, "config.ts")),
  ])
    .then(([runtime, config]) => ({ runtime, config }))
    .catch((error) => {
      mcpAdapterRuntimeModules = undefined;
      throw error;
    });
  return mcpAdapterRuntimeModules;
}

async function createSceneMcpAdapterFactory(
  cwd: string,
  sceneMcpServers: readonly SceneMcpServerConfig[],
  loadAmbientConfig?: (cwd: string) => McpConfig,
): Promise<ExtensionFactory> {
  const { runtime, config } = await loadMcpAdapterRuntimeModules();
  return async (pi) => {
    const ambient = loadAmbientConfig
      ? loadAmbientConfig(cwd)
      : config.loadMcpConfig(undefined, cwd);
    const factory = runtime.createMcpAdapter({
      config: mergeSceneMcpServers(ambient, sceneMcpServers),
    });
    await factory(pi);
  };
}

export function getBundledMcpAdapterResources(): BundledMcpAdapterResources {
  // 两种启动器都会把 cwd 固定为应用根目录；避免 require.resolve 让 Next 在构建期解析 Adapter 的 TS 源码。
  const packageRoot = join(process.cwd(), "node_modules", "pi-mcp-adapter");
  return {
    extensionPaths: [join(packageRoot, "index.ts")],
    skillPaths: [join(packageRoot, "skills")],
  };
}

function readBundledMcpAdapterVersion(packageRoot: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function getBundledMcpAdapterPluginInfo(enabled = true): PluginPackageInfo {
  const bundled = getBundledMcpAdapterResources();
  const extensionPath = bundled.extensionPaths[0];
  const skillPath = join(bundled.skillPaths[0], "mcp-scripting", "SKILL.md");
  const packageRoot = join(process.cwd(), "node_modules", "pi-mcp-adapter");
  const extensionLoaded = enabled && existsSync(extensionPath);
  const skillLoaded = enabled && existsSync(skillPath);
  const counts = {
    extensions: extensionLoaded ? 1 : 0,
    skills: skillLoaded ? 1 : 0,
    prompts: 0,
    themes: 0,
  };
  const resources = [
    ...(extensionLoaded ? [{ kind: "extension" as const, name: "pi-mcp-adapter", path: extensionPath, relativePath: "index.ts" }] : []),
    ...(skillLoaded ? [{ kind: "skill" as const, name: "mcp-scripting", path: skillPath, relativePath: "skills/mcp-scripting/SKILL.md" }] : []),
  ];
  return {
    source: "pi-mcp-adapter",
    scope: "global",
    builtin: true,
    filtered: false,
    disabled: !enabled,
    installedPath: existsSync(packageRoot) ? packageRoot : undefined,
    packageName: "pi-mcp-adapter",
    version: readBundledMcpAdapterVersion(packageRoot),
    counts,
    resources,
    status: !enabled ? "disabled" : extensionLoaded && skillLoaded ? "loaded" : "missing",
  };
}

export function isMcpAdapterSource(source: string): boolean {
  return source === MCP_ADAPTER_SOURCE || source.startsWith(`${MCP_ADAPTER_SOURCE}@`);
}

export async function migrateUserMcpAdapterPackages(
  packageManager: Pick<PackageManager, "listConfiguredPackages" | "removeAndPersist">,
): Promise<string[]> {
  const sources = packageManager
    .listConfiguredPackages()
    .filter((pkg) => pkg.scope === "user" && isMcpAdapterSource(pkg.source))
    .map((pkg) => pkg.source);

  // 仅移除 Pi 包记录和 npm 包；MCP 配置、集成运行时、缓存与系统凭据均不属于包管理器职责。
  for (const source of sources) {
    await packageManager.removeAndPersist(source, { local: false });
  }
  return sources;
}

export async function prepareBundledMcpAdapter(
  packageManager: Pick<PackageManager, "listConfiguredPackages" | "removeAndPersist">,
  options?: PrepareBundledMcpAdapterOptions,
): Promise<BundledMcpAdapterResources> {
  const bundledResources = getBundledMcpAdapterResources();
  const projectOverridesBuiltin = packageManager
    .listConfiguredPackages()
    .some((pkg) => pkg.scope === "project" && isMcpAdapterSource(pkg.source));
  await migrateUserMcpAdapterPackages(packageManager);
  if (projectOverridesBuiltin) {
    if (!options || options.sceneMcpServers.length === 0) {
      return { extensionPaths: [], skillPaths: [] };
    }
  }
  if (!options || options.sceneMcpServers.length === 0) return bundledResources;
  return {
    extensionPaths: [],
    skillPaths: projectOverridesBuiltin ? [] : bundledResources.skillPaths,
    extensionFactories: [{
      name: "pi-mcp-adapter",
      factory: await createSceneMcpAdapterFactory(
        options.cwd,
        options.sceneMcpServers,
        options.loadAmbientConfig,
      ),
    }],
  };
}
