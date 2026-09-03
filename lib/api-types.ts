import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import type { SceneId } from "./scenes";

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export type SkillArchiveRisk =
  | "instructions-only"
  | "supporting-files"
  | "integration-runtime";

export interface SkillArchiveInspection {
  sha256: string;
  kind: "skill" | "integration";
  risk: SkillArchiveRisk;
  skill: {
    name: string;
    description: string;
    fileCount: number;
  };
  archive: {
    fileCount: number;
    expandedBytes: number;
  };
  integration?: {
    id: string;
    version: string;
    mcp?: {
      serverName: string;
      executable: string;
      requiredTools: string[];
      environmentNames: string[];
    };
  };
}

export interface SkillArchiveInspectionResponse {
  inspection: SkillArchiveInspection;
}

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export interface SkillArchiveInstallInfo {
  kind: "skill" | "integration";
  scope: SkillInstallScope;
  integrationId?: string;
  mcpServer?: string;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
  archiveInstall?: SkillArchiveInstallInfo;
  builtInSceneId?: SceneId;
  readOnly?: boolean;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  builtin?: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}
