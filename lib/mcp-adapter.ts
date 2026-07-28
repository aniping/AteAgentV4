import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { SkillArchiveInstallScope } from "./skill-archive-install";

const MCP_ADAPTER_SOURCE = "npm:pi-mcp-adapter";

export function isMcpAdapterSource(source: string): boolean {
  return source === MCP_ADAPTER_SOURCE || source.startsWith(`${MCP_ADAPTER_SOURCE}@`);
}

export function hasUsableMcpAdapter(
  extensions: readonly ResolvedResource[],
  installScope: SkillArchiveInstallScope,
): boolean {
  return extensions.some((extension) => {
    const { metadata } = extension;
    if (!extension.enabled || metadata.origin !== "package" || !isMcpAdapterSource(metadata.source)) {
      return false;
    }
    return metadata.scope === "user" || (installScope === "project" && metadata.scope === "project");
  });
}

export { MCP_ADAPTER_SOURCE };
