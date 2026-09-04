import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadExtensionsResult, PackageManager } from "@earendil-works/pi-coding-agent";
import type { PluginPackageInfo } from "./api-types";
import { samePath } from "./paths";

const SUBAGENTS_PACKAGE_NAME = "@tintinweb/pi-subagents";
const SUBAGENTS_SOURCE = `npm:${SUBAGENTS_PACKAGE_NAME}`;
export const SUBAGENT_TOOL_NAMES = [
  "Agent",
  "SubagentWorkflow",
  "get_subagent_result",
  "steer_subagent",
] as const;
const SUBAGENT_TOOL_NAME_SET = new Set<string>(SUBAGENT_TOOL_NAMES);
const MUTATING_BUILTIN_TOOL_NAMES = new Set(["bash", "edit", "write"]);

function getBundledSubagentsPackageRoot(): string {
  return join(process.cwd(), "node_modules", "@tintinweb", "pi-subagents");
}

export interface BundledSubagentsResources {
  extensionPaths: string[];
}

export function getBundledSubagentsResources(): BundledSubagentsResources {
  const packageRoot = getBundledSubagentsPackageRoot();
  return {
    extensionPaths: [join(packageRoot, "src", "index.ts")],
  };
}

function readBundledSubagentsVersion(packageRoot: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function getBundledSubagentsPluginInfo(enabled = true): PluginPackageInfo {
  const packageRoot = getBundledSubagentsPackageRoot();
  const extensionPath = getBundledSubagentsResources().extensionPaths[0];
  const extensionLoaded = enabled && existsSync(extensionPath);

  return {
    source: SUBAGENTS_PACKAGE_NAME,
    scope: "global",
    builtin: true,
    filtered: false,
    disabled: !enabled,
    installedPath: existsSync(packageRoot) ? packageRoot : undefined,
    packageName: SUBAGENTS_PACKAGE_NAME,
    version: readBundledSubagentsVersion(packageRoot),
    counts: { extensions: extensionLoaded ? 1 : 0, skills: 0, prompts: 0, themes: 0 },
    resources: extensionLoaded
      ? [{
          kind: "extension",
          name: "pi-subagents",
          path: extensionPath,
          relativePath: "src/index.ts",
        }]
      : [],
    status: !enabled ? "disabled" : extensionLoaded ? "loaded" : "missing",
  };
}

export function isSubagentsSource(source: string): boolean {
  return source === SUBAGENTS_SOURCE || source.startsWith(`${SUBAGENTS_SOURCE}@`);
}

export function filterSubagentToolsForPreset(
  extensionToolNames: string[],
  requestedToolNames: string[],
): string[] {
  const explicitlyRequested = requestedToolNames.some((name) => SUBAGENT_TOOL_NAME_SET.has(name));
  const allowsMutation = requestedToolNames.some((name) => MUTATING_BUILTIN_TOOL_NAMES.has(name));
  if (explicitlyRequested || allowsMutation) return extensionToolNames;
  return extensionToolNames.filter((name) => !SUBAGENT_TOOL_NAME_SET.has(name));
}

function isSubagentsExtensionPath(extensionPath: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]@tintinweb[\\/]pi-subagents[\\/]/i.test(extensionPath);
}

export function preferLoadedProjectSubagents(base: LoadExtensionsResult): LoadExtensionsResult {
  const bundledPath = getBundledSubagentsResources().extensionPaths[0];
  const bundled = base.extensions.find((extension) => samePath(extension.resolvedPath, bundledPath));
  if (!bundled) return base;

  const projectCopy = base.extensions.find(
    (extension) => extension !== bundled && isSubagentsExtensionPath(extension.resolvedPath),
  );
  if (!projectCopy) return base;

  const isPairConflict = (path: string, error: string): boolean => (
    (samePath(path, projectCopy.path) && error.endsWith(`conflicts with ${bundled.path}`))
    || (samePath(path, bundled.path) && error.endsWith(`conflicts with ${projectCopy.path}`))
  );
  return {
    ...base,
    extensions: base.extensions.filter((extension) => extension !== bundled),
    errors: base.errors.filter((error) => !isPairConflict(error.path, error.error)),
  };
}

export async function migrateUserSubagentsPackages(
  packageManager: Pick<PackageManager, "listConfiguredPackages" | "removeAndPersist">,
): Promise<string[]> {
  const sources = packageManager
    .listConfiguredPackages()
    .filter((pkg) => pkg.scope === "user" && isSubagentsSource(pkg.source))
    .map((pkg) => pkg.source);

  for (const source of sources) {
    await packageManager.removeAndPersist(source, { local: false });
  }
  return sources;
}

export async function prepareBundledSubagents(
  packageManager: Pick<PackageManager, "listConfiguredPackages" | "removeAndPersist">,
): Promise<BundledSubagentsResources> {
  await migrateUserSubagentsPackages(packageManager);
  return getBundledSubagentsResources();
}
