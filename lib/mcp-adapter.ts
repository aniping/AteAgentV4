import type { PackageManager } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginPackageInfo } from "./api-types";

const MCP_ADAPTER_SOURCE = "npm:pi-mcp-adapter";

interface BundledMcpAdapterResources {
  extensionPaths: string[];
  skillPaths: string[];
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
): Promise<BundledMcpAdapterResources> {
  const bundledResources = getBundledMcpAdapterResources();
  const projectOverridesBuiltin = packageManager
    .listConfiguredPackages()
    .some((pkg) => pkg.scope === "project" && isMcpAdapterSource(pkg.source));
  await migrateUserMcpAdapterPackages(packageManager);
  return projectOverridesBuiltin ? { extensionPaths: [], skillPaths: [] } : bundledResources;
}
