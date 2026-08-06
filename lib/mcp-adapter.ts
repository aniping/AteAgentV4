import type { PackageManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

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
