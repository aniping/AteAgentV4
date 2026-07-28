import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ParsedSkillArchive, SkillArchiveFile } from "./skill-archive";
import { SkillArchiveConflictError, SkillArchiveError } from "./skill-archive";

export type SkillArchiveInstallScope = "global" | "project";

export interface SkillArchiveInstallOptions {
  scope: SkillArchiveInstallScope;
  cwd: string;
  agentDir: string;
  ensureMcpSupport?: () => Promise<boolean>;
}

export interface SkillArchiveInstallResult {
  kind: ParsedSkillArchive["kind"];
  scope: SkillArchiveInstallScope;
  skillName: string;
  skillPath: string;
  integrationPath?: string;
  mcpServer?: string;
  mcpAdapterInstalled?: boolean;
}

interface McpConfigPlan {
  path: string;
  content: string;
}

declare global {
  var __piMcpConfigLocks: Map<string, Promise<void>> | undefined;
}

function mcpConfigLocks(): Map<string, Promise<void>> {
  return globalThis.__piMcpConfigLocks ??= new Map();
}

async function withMcpConfigLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const locks = mcpConfigLocks();
  const previous = locks.get(path) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  locks.set(path, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(path) === tail) locks.delete(path);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertTargetAvailable(path: string, label: string): Promise<void> {
  if (await pathExists(path)) throw new SkillArchiveConflictError(`${label} already exists: ${path}`);
}

async function writeArchiveFiles(root: string, files: SkillArchiveFile[]): Promise<void> {
  for (const file of files) {
    const destination = join(root, ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.data, { flag: "wx" });
    if (process.platform !== "win32" && file.mode !== undefined) {
      await chmod(destination, file.mode & 0o777);
    }
  }
}

async function ensureExecutable(root: string, archivePath: string): Promise<void> {
  if (process.platform === "win32") return;
  const path = join(root, ...archivePath.split("/"));
  const current = await stat(path);
  await chmod(path, current.mode | 0o100);
}

function configObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillArchiveError(`MCP configuration must contain a JSON object: ${path}`);
  }
  return value as Record<string, unknown>;
}

async function planMcpConfig(
  archive: Extract<ParsedSkillArchive, { kind: "integration" }>,
  integrationPath: string,
  options: SkillArchiveInstallOptions,
): Promise<McpConfigPlan | undefined> {
  if (!archive.mcp) return undefined;
  const configPath = options.scope === "project"
    ? join(options.cwd, ".pi", "mcp.json")
    : join(options.agentDir, "mcp.json");
  let config: Record<string, unknown> = {};
  try {
    config = configObject(JSON.parse(await readFile(configPath, "utf8")), configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SkillArchiveError) throw error;
      throw new SkillArchiveError(`Invalid MCP configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const rawServers = config.mcpServers ?? {};
  const servers = configObject(rawServers, configPath);
  if (Object.prototype.hasOwnProperty.call(servers, archive.mcp.serverName)) {
    throw new SkillArchiveConflictError(`MCP server already exists: ${archive.mcp.serverName}`);
  }
  const server: Record<string, unknown> = {
    command: join(integrationPath, ...archive.mcp.executable.split("/")),
    directTools: archive.mcp.requiredTools.length > 0 ? archive.mcp.requiredTools : true,
  };
  if (archive.mcp.args.length > 0) server.args = archive.mcp.args;
  if (archive.mcp.env && Object.keys(archive.mcp.env).length > 0) server.env = archive.mcp.env;
  return {
    path: configPath,
    content: `${JSON.stringify({ ...config, mcpServers: { ...servers, [archive.mcp.serverName]: server } }, null, 2)}\n`,
  };
}

async function writeJsonAtomically(plan: McpConfigPlan): Promise<void> {
  await mkdir(dirname(plan.path), { recursive: true });
  const temporary = join(dirname(plan.path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, plan.content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, plan.path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function installSkillArchive(
  archive: ParsedSkillArchive,
  options: SkillArchiveInstallOptions,
): Promise<SkillArchiveInstallResult> {
  const skillsRoot = options.scope === "project"
    ? join(options.cwd, ".pi", "skills")
    : join(options.agentDir, "skills");
  const skillPath = join(skillsRoot, archive.skill.name);
  await assertTargetAvailable(skillPath, "Skill target");

  const integrationPath = archive.kind === "integration"
    ? join(
        options.scope === "project" ? join(options.cwd, ".pi", "integrations") : join(options.agentDir, "integrations"),
        archive.id,
      )
    : undefined;
  if (integrationPath) await assertTargetAvailable(integrationPath, "Integration target");
  const mcpConfig = archive.kind === "integration" && integrationPath
    ? await planMcpConfig(archive, integrationPath, options)
    : undefined;

  let mcpAdapterInstalled: boolean | undefined;
  if (mcpConfig) {
    if (!options.ensureMcpSupport) throw new SkillArchiveError("MCP support installer is unavailable");
    mcpAdapterInstalled = await options.ensureMcpSupport();
  }

  await mkdir(skillsRoot, { recursive: true });
  const stagedSkill = await mkdtemp(join(skillsRoot, ".upload-"));
  let stagedIntegration: string | undefined;
  const moved: string[] = [];
  try {
    await writeArchiveFiles(stagedSkill, archive.skill.files);
    if (archive.kind === "integration" && integrationPath) {
      const integrationsRoot = dirname(integrationPath);
      await mkdir(integrationsRoot, { recursive: true });
      stagedIntegration = await mkdtemp(join(integrationsRoot, ".upload-"));
      await writeArchiveFiles(stagedIntegration, archive.files);
      if (archive.mcp) await ensureExecutable(stagedIntegration, archive.mcp.executable);
    }

    await rename(stagedSkill, skillPath);
    moved.push(skillPath);
    if (stagedIntegration && integrationPath) {
      await rename(stagedIntegration, integrationPath);
      moved.push(integrationPath);
    }
    if (mcpConfig && archive.kind === "integration" && integrationPath) {
      await withMcpConfigLock(mcpConfig.path, async () => {
        const latest = await planMcpConfig(archive, integrationPath, options);
        if (latest) await writeJsonAtomically(latest);
      });
    }

    return {
      kind: archive.kind,
      scope: options.scope,
      skillName: archive.skill.name,
      skillPath,
      integrationPath,
      mcpServer: archive.kind === "integration" ? archive.mcp?.serverName : undefined,
      mcpAdapterInstalled,
    };
  } catch (error) {
    for (const path of moved.reverse()) await rm(path, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await rm(stagedSkill, { recursive: true, force: true }).catch(() => {});
    if (stagedIntegration) await rm(stagedIntegration, { recursive: true, force: true }).catch(() => {});
  }
}
