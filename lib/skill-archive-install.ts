import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

export interface SkillArchiveInstallation {
  kind: ParsedSkillArchive["kind"];
  scope: SkillArchiveInstallScope;
  skillName: string;
  integrationId?: string;
  mcpServer?: string;
}

interface SkillArchiveReceipt {
  schemaVersion: 1;
  kind: ParsedSkillArchive["kind"];
  skillName: string;
  integrationId?: string;
  mcpServer?: string;
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

function scopeRoot(options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">, scope: SkillArchiveInstallScope): string {
  return scope === "project" ? join(options.cwd, ".pi") : options.agentDir;
}

function skillsRoot(options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">, scope: SkillArchiveInstallScope): string {
  return join(scopeRoot(options, scope), "skills");
}

function integrationsRoot(options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">, scope: SkillArchiveInstallScope): string {
  return join(scopeRoot(options, scope), "integrations");
}

function receiptsRoot(options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">, scope: SkillArchiveInstallScope): string {
  return join(scopeRoot(options, scope), "skill-archives");
}

function validateSafeName(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : undefined;
}

function validateMcpServerName(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    ? value
    : undefined;
}

function parseReceipt(value: unknown): SkillArchiveReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const receipt = value as Record<string, unknown>;
  if (receipt.schemaVersion !== 1 || (receipt.kind !== "skill" && receipt.kind !== "integration")) {
    return undefined;
  }
  const skillName = validateSafeName(receipt.skillName);
  if (!skillName) return undefined;
  if (receipt.kind === "skill") return { schemaVersion: 1, kind: "skill", skillName };
  const integrationId = validateSafeName(receipt.integrationId);
  if (!integrationId) return undefined;
  const mcpServer = receipt.mcpServer === undefined
    ? undefined
    : validateMcpServerName(receipt.mcpServer);
  if (receipt.mcpServer !== undefined && !mcpServer) return undefined;
  return { schemaVersion: 1, kind: "integration", skillName, integrationId, mcpServer };
}

function archiveReceipt(archive: ParsedSkillArchive): SkillArchiveReceipt {
  return archive.kind === "integration"
    ? {
        schemaVersion: 1,
        kind: "integration",
        skillName: archive.skill.name,
        integrationId: archive.id,
        mcpServer: archive.mcp?.serverName,
      }
    : { schemaVersion: 1, kind: "skill", skillName: archive.skill.name };
}

async function readReceipts(
  options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">,
  scope: SkillArchiveInstallScope,
): Promise<SkillArchiveInstallation[]> {
  const root = receiptsRoot(options, scope);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const installations: SkillArchiveInstallation[] = [];
  for (const entry of entries.slice(0, 512)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const receipt = parseReceipt(JSON.parse(await readFile(join(root, entry.name), "utf8")));
      if (!receipt || entry.name !== `${receipt.skillName}.json`) continue;
      installations.push({
        kind: receipt.kind,
        scope,
        skillName: receipt.skillName,
        integrationId: receipt.integrationId,
        mcpServer: receipt.mcpServer,
      });
    } catch {
      // Ignore malformed receipts; they cannot authorize deletion.
    }
  }
  return installations;
}

async function discoverLegacyIntegrations(
  options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">,
  scope: SkillArchiveInstallScope,
): Promise<SkillArchiveInstallation[]> {
  const root = integrationsRoot(options, scope);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const installations: SkillArchiveInstallation[] = [];
  for (const entry of entries.slice(0, 512)) {
    if (!entry.isDirectory() || !validateSafeName(entry.name)) continue;
    try {
      const manifest = JSON.parse(
        await readFile(join(root, entry.name, "ateagent-integration.json"), "utf8"),
      ) as Record<string, unknown>;
      const id = validateSafeName(manifest.id);
      const skill = manifest.skill && typeof manifest.skill === "object" && !Array.isArray(manifest.skill)
        ? manifest.skill as Record<string, unknown>
        : undefined;
      const skillName = validateSafeName(skill?.name);
      const mcp = manifest.mcp && typeof manifest.mcp === "object" && !Array.isArray(manifest.mcp)
        ? manifest.mcp as Record<string, unknown>
        : undefined;
      const mcpServer = mcp?.serverName === undefined ? undefined : validateMcpServerName(mcp.serverName);
      if (manifest.schemaVersion !== 1 || id !== entry.name || !skillName) continue;
      if (mcp?.serverName !== undefined && !mcpServer) continue;
      installations.push({
        kind: "integration",
        scope,
        skillName,
        integrationId: id,
        mcpServer,
      });
    } catch {
      // Older or unrelated integration directories are not ZIP installations.
    }
  }
  return installations;
}

export async function listSkillArchiveInstallations(
  options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">,
): Promise<SkillArchiveInstallation[]> {
  const installations: SkillArchiveInstallation[] = [];
  for (const scope of ["global", "project"] as const) {
    const receipts = await readReceipts(options, scope);
    const bySkill = new Map(receipts.map((entry) => [entry.skillName, entry]));
    for (const legacy of await discoverLegacyIntegrations(options, scope)) {
      if (!bySkill.has(legacy.skillName)) bySkill.set(legacy.skillName, legacy);
    }
    installations.push(...bySkill.values());
  }
  return installations;
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

function isWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function planMcpConfigRemoval(
  installation: SkillArchiveInstallation,
  integrationPath: string | undefined,
  options: Pick<SkillArchiveInstallOptions, "cwd" | "agentDir">,
): Promise<McpConfigPlan | undefined> {
  if (!installation.mcpServer || !integrationPath) return undefined;
  const configPath = installation.scope === "project"
    ? join(options.cwd, ".pi", "mcp.json")
    : join(options.agentDir, "mcp.json");
  let config: Record<string, unknown>;
  try {
    config = configObject(JSON.parse(await readFile(configPath, "utf8")), configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SkillArchiveError) throw error;
    throw new SkillArchiveError(`Invalid MCP configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const servers = configObject(config.mcpServers ?? {}, configPath);
  if (!Object.prototype.hasOwnProperty.call(servers, installation.mcpServer)) return undefined;
  const server = configObject(servers[installation.mcpServer], configPath);
  if (typeof server.command !== "string" || !isWithin(server.command, integrationPath)) {
    throw new SkillArchiveConflictError(
      `MCP server ${installation.mcpServer} no longer points to this integration`,
    );
  }
  const nextServers = { ...servers };
  delete nextServers[installation.mcpServer];
  return {
    path: configPath,
    content: `${JSON.stringify({ ...config, mcpServers: nextServers }, null, 2)}\n`,
  };
}

export async function uninstallSkillArchive(
  skillName: string,
  options: Pick<SkillArchiveInstallOptions, "scope" | "cwd" | "agentDir">,
): Promise<SkillArchiveInstallation> {
  if (!validateSafeName(skillName)) throw new SkillArchiveError("Invalid skill name");
  const installation = (await listSkillArchiveInstallations(options)).find(
    (entry) => entry.scope === options.scope && entry.skillName === skillName,
  );
  if (!installation) throw new SkillArchiveError(`ZIP-installed skill not found: ${skillName}`);

  const skillPath = join(skillsRoot(options, options.scope), skillName);
  const integrationPath = installation.integrationId
    ? join(integrationsRoot(options, options.scope), installation.integrationId)
    : undefined;
  const receiptPath = join(receiptsRoot(options, options.scope), `${skillName}.json`);
  const staged: Array<{ original: string; temporary: string }> = [];
  const stage = async (path: string, label: string) => {
    if (!await pathExists(path)) return;
    const temporary = join(dirname(path), `.uninstall-${randomUUID()}-${label}`);
    await rename(path, temporary);
    staged.push({ original: path, temporary });
  };

  try {
    await stage(skillPath, "skill");
    if (integrationPath) await stage(integrationPath, "integration");
    await stage(receiptPath, "receipt");
    const configPath = options.scope === "project"
      ? join(options.cwd, ".pi", "mcp.json")
      : join(options.agentDir, "mcp.json");
    await withMcpConfigLock(configPath, async () => {
      const plan = await planMcpConfigRemoval(installation, integrationPath, options);
      if (plan) await writeJsonAtomically(plan);
    });
  } catch (error) {
    for (const item of staged.reverse()) {
      if (await pathExists(item.temporary)) await rename(item.temporary, item.original).catch(() => {});
    }
    throw error;
  }

  await Promise.all(staged.map((item) => rm(item.temporary, { recursive: true, force: true }).catch(() => {})));
  return installation;
}

export async function installSkillArchive(
  archive: ParsedSkillArchive,
  options: SkillArchiveInstallOptions,
): Promise<SkillArchiveInstallResult> {
  const targetSkillsRoot = skillsRoot(options, options.scope);
  const targetIntegrationsRoot = integrationsRoot(options, options.scope);
  const targetReceiptsRoot = receiptsRoot(options, options.scope);
  const skillPath = join(targetSkillsRoot, archive.skill.name);
  await assertTargetAvailable(skillPath, "Skill target");
  const receiptPath = join(targetReceiptsRoot, `${archive.skill.name}.json`);
  await assertTargetAvailable(receiptPath, "Skill archive receipt");

  const integrationPath = archive.kind === "integration"
    ? join(targetIntegrationsRoot, archive.id)
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

  await mkdir(targetSkillsRoot, { recursive: true });
  const stagedSkill = await mkdtemp(join(targetSkillsRoot, ".upload-"));
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
    await mkdir(targetReceiptsRoot, { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(archiveReceipt(archive), null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    moved.push(receiptPath);
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
