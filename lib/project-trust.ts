import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectTrustStatus } from "./api-types";

function canonicalizeProjectPath(cwd: string): string {
  if (!cwd) return cwd;
  try {
    // Windows 的 native realpath 会把 ADMINI~1 等 8.3 别名统一成长路径，避免信任记录分裂。
    return process.platform === "win32" ? realpathSync.native(cwd) : realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const projectPath = canonicalizeProjectPath(cwd);
  const requiresTrust = Boolean(projectPath) && hasTrustRequiringProjectResources(projectPath);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  const trustStore = new ProjectTrustStore(agentDir);
  return {
    requiresTrust: true,
    trusted: trustStore.get(projectPath) === true,
  };
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  new ProjectTrustStore(agentDir).set(canonicalizeProjectPath(cwd), true);
  return { requiresTrust: true, trusted: true };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  const projectPath = canonicalizeProjectPath(cwd);
  return { resolveProjectTrust: async () => trustStore.get(projectPath) === true };
}
