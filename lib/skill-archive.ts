import { createHash } from "node:crypto";
import JSZip from "jszip";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const MAX_SKILL_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_EXPANDED_BYTES = 128 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_ENTRIES = 512;

const INTEGRATION_MANIFEST = "ateagent-integration.json";
const CHECKSUM_MANIFEST = "SHA256SUMS.json";

export class SkillArchiveError extends Error {}
export class SkillArchiveConflictError extends SkillArchiveError {}

export interface SkillArchiveFile {
  path: string;
  data: Buffer;
  mode?: number;
}

export interface ParsedArchiveSkill {
  name: string;
  description: string;
  files: SkillArchiveFile[];
}

export interface SkillArchiveMcp {
  serverName: string;
  executable: string;
  requiredTools: string[];
  args: string[];
  env?: Record<string, string>;
}

export type ParsedSkillArchive =
  | {
      kind: "skill";
      skill: ParsedArchiveSkill;
    }
  | {
      kind: "integration";
      id: string;
      version: string;
      skill: ParsedArchiveSkill;
      files: SkillArchiveFile[];
      mcp?: SkillArchiveMcp;
    };

interface IntegrationManifest {
  schemaVersion?: unknown;
  id?: unknown;
  version?: unknown;
  platform?: unknown;
  arch?: unknown;
  skill?: unknown;
  mcp?: unknown;
}

interface ZipObjectWithSize extends JSZip.JSZipObject {
  _data?: { uncompressedSize?: number; crc32?: number };
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function archiveError(message: string): never {
  throw new SkillArchiveError(message);
}

function normalizedArchivePath(rawPath: string, directory: boolean): string {
  if (!rawPath || rawPath.includes("\0") || rawPath.includes("\\")) {
    return archiveError(`Invalid archive path: ${JSON.stringify(rawPath)}`);
  }
  if (rawPath.startsWith("/") || /^[a-zA-Z]:/.test(rawPath)) {
    return archiveError(`Archive paths must be relative: ${rawPath}`);
  }
  const trimmed = directory ? rawPath.replace(/\/+$/, "") : rawPath;
  const segments = trimmed.split("/");
  if (!trimmed || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return archiveError(`Invalid archive path: ${rawPath}`);
  }
  return trimmed;
}

function unixMode(entry: JSZip.JSZipObject): number | undefined {
  if (typeof entry.unixPermissions === "number") return entry.unixPermissions;
  if (typeof entry.unixPermissions === "string") {
    const parsed = Number.parseInt(entry.unixPermissions, 8);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function validateSkillName(name: unknown): string {
  if (typeof name !== "string" || !name) return archiveError("SKILL.md frontmatter must define a name");
  if (name.length > 64) return archiveError("Skill name must be 64 characters or fewer");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    return archiveError("Skill name must use lowercase letters, numbers, and single hyphens");
  }
  return name;
}

function validateSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 64) {
    return archiveError(`${label} must be a non-empty string of at most 64 characters`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return archiveError(`${label} must use lowercase letters, numbers, and single hyphens`);
  }
  return value;
}

function validateMcpServerName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    return archiveError("mcp.serverName must use 1-64 letters, numbers, dots, underscores, or hyphens");
  }
  return value;
}

function parseSkillMetadata(skillFile: SkillArchiveFile): { name: string; description: string } {
  let frontmatter: Record<string, unknown>;
  try {
    ({ frontmatter } = parseFrontmatter(skillFile.data.toString("utf8")));
  } catch (error) {
    return archiveError(`Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  const name = validateSkillName(frontmatter.name);
  const description = frontmatter.description;
  if (typeof description !== "string" || !description.trim()) {
    return archiveError("SKILL.md frontmatter must define a description");
  }
  if (description.length > 1024) return archiveError("Skill description must be 1024 characters or fewer");
  return { name, description };
}

function parseJsonObject(file: SkillArchiveFile, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(file.data.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return archiveError(`${label} must contain a JSON object`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    return archiveError(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function relativeFiles(files: SkillArchiveFile[], root: string): SkillArchiveFile[] {
  const prefix = root ? `${root}/` : "";
  return files
    .filter((file) => !root || file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(prefix.length) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function requireSingleSkill(files: SkillArchiveFile[], declaredRoot?: string): ParsedArchiveSkill {
  const skillPaths = files.filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"));
  if (skillPaths.length !== 1) {
    return archiveError("Archive must contain exactly one SKILL.md");
  }
  const skillPath = skillPaths[0].path;
  const root = skillPath === "SKILL.md" ? "" : skillPath.slice(0, -"/SKILL.md".length);
  if (declaredRoot !== undefined && root !== declaredRoot) {
    return archiveError(`Manifest skill.path must point to the directory containing SKILL.md (${root || "."})`);
  }
  const selected = relativeFiles(files, root);
  if (!declaredRoot && selected.length !== files.length) {
    return archiveError("Plain skill archives cannot contain files outside the skill directory");
  }
  const metadata = parseSkillMetadata(selected.find((file) => file.path === "SKILL.md")!);
  return { ...metadata, files: selected };
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return archiveError(`${label} must be an array of strings`);
  }
  return value;
}

function parseEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return archiveError("mcp.env must be an object of string values");
  }
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key && typeof item === "string")) {
    return archiveError("mcp.env must be an object of string values");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseMcp(value: unknown, filesByPath: Map<string, SkillArchiveFile>): SkillArchiveMcp | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return archiveError("mcp must be a JSON object");
  }
  const mcp = value as Record<string, unknown>;
  const serverName = validateMcpServerName(mcp.serverName);
  if (typeof mcp.executable !== "string") return archiveError("mcp.executable is required");
  const executable = normalizedArchivePath(mcp.executable, false);
  if (!filesByPath.has(executable)) return archiveError(`MCP executable is missing: ${executable}`);
  const requiredTools = requireStringArray(mcp.requiredTools ?? [], "mcp.requiredTools");
  if (requiredTools.some((tool) => !tool || tool.length > 128 || /\s/.test(tool))) {
    return archiveError("mcp.requiredTools contains an invalid tool name");
  }
  const args = requireStringArray(mcp.args ?? [], "mcp.args");
  return { serverName, executable, requiredTools, args, env: parseEnvironment(mcp.env) };
}

function verifyChecksums(files: SkillArchiveFile[], checksumFile: SkillArchiveFile): void {
  const checksumJson = parseJsonObject(checksumFile, CHECKSUM_MANIFEST);
  if (checksumJson.schemaVersion !== 1 || !checksumJson.files || typeof checksumJson.files !== "object" || Array.isArray(checksumJson.files)) {
    return archiveError(`${CHECKSUM_MANIFEST} must use schemaVersion 1 and define files`);
  }
  const declared = checksumJson.files as Record<string, unknown>;
  const expected = files.filter((file) => file.path !== CHECKSUM_MANIFEST);
  const expectedPaths = new Set(expected.map((file) => file.path));
  if (Object.keys(declared).length !== expected.length) {
    return archiveError(`${CHECKSUM_MANIFEST} must list every archive file except itself`);
  }
  for (const [rawPath, digest] of Object.entries(declared)) {
    const path = normalizedArchivePath(rawPath, false);
    if (!expectedPaths.has(path)) return archiveError(`Checksum lists an unexpected file: ${path}`);
    if (typeof digest !== "string" || !/^[a-fA-F0-9]{64}$/.test(digest)) {
      return archiveError(`Invalid SHA-256 digest for ${path}`);
    }
  }
  for (const file of expected) {
    const actual = createHash("sha256").update(file.data).digest("hex");
    if ((declared[file.path] as string).toLowerCase() !== actual) {
      return archiveError(`SHA-256 mismatch for ${file.path}`);
    }
  }
}

async function readZipEntry(
  entry: ZipObjectWithSize,
  path: string,
  maxBytes: number,
  limitMessage: string,
): Promise<Buffer> {
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const stream = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & {
        destroy?: (error?: Error) => void;
      };
      const chunks: Buffer[] = [];
      let total = 0;
      let crc = -1;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (stream.destroy) stream.destroy(error);
        else stream.pause();
        reject(error);
      };
      stream.on("data", (value: Buffer | Uint8Array) => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          fail(new SkillArchiveError(limitMessage));
          return;
        }
        for (const byte of chunk) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        chunks.push(chunk);
      });
      stream.on("error", (error: Error) => fail(error));
      stream.on("end", () => {
        if (settled) return;
        const expectedCrc = entry._data?.crc32;
        if (typeof expectedCrc === "number" && ((crc ^ -1) >>> 0) !== (expectedCrc >>> 0)) {
          fail(new SkillArchiveError(`CRC32 mismatch for ${path}`));
          return;
        }
        settled = true;
        resolve(Buffer.concat(chunks, total));
      });
    });
  } catch (error) {
    if (error instanceof SkillArchiveError) throw error;
    return archiveError(`Failed to extract ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseIntegration(files: SkillArchiveFile[], manifestFile: SkillArchiveFile): ParsedSkillArchive {
  const manifest = parseJsonObject(manifestFile, INTEGRATION_MANIFEST) as IntegrationManifest;
  if (manifest.schemaVersion !== 1) return archiveError(`${INTEGRATION_MANIFEST} must use schemaVersion 1`);
  const id = validateSafeIdentifier(manifest.id, "Integration id");
  if (typeof manifest.version !== "string" || !manifest.version || manifest.version.length > 64) {
    return archiveError("Integration version must be a non-empty string of at most 64 characters");
  }
  if (manifest.platform !== undefined && manifest.platform !== process.platform) {
    return archiveError(`Integration requires platform ${String(manifest.platform)}; current platform is ${process.platform}`);
  }
  if (manifest.arch !== undefined && manifest.arch !== process.arch) {
    return archiveError(`Integration requires architecture ${String(manifest.arch)}; current architecture is ${process.arch}`);
  }
  if (!manifest.skill || typeof manifest.skill !== "object" || Array.isArray(manifest.skill)) {
    return archiveError("Manifest skill must be a JSON object");
  }
  const skillDeclaration = manifest.skill as Record<string, unknown>;
  if (typeof skillDeclaration.path !== "string") return archiveError("Manifest skill.path is required");
  const skillRoot = normalizedArchivePath(skillDeclaration.path, true);
  const skill = requireSingleSkill(files, skillRoot);
  if (skillDeclaration.name !== undefined && skillDeclaration.name !== skill.name) {
    return archiveError("Manifest skill.name must match SKILL.md frontmatter name");
  }
  const checksumFile = files.find((file) => file.path === CHECKSUM_MANIFEST);
  if (!checksumFile) return archiveError(`Integration archives must contain ${CHECKSUM_MANIFEST}`);
  verifyChecksums(files, checksumFile);
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  return {
    kind: "integration",
    id,
    version: manifest.version,
    skill,
    files,
    mcp: parseMcp(manifest.mcp, filesByPath),
  };
}

export async function parseSkillArchive(input: Buffer | Uint8Array): Promise<ParsedSkillArchive> {
  if (input.byteLength > MAX_SKILL_ARCHIVE_BYTES) {
    return archiveError("Skill ZIP must be 50MB or smaller");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input, { checkCRC32: false, createFolders: false });
  } catch (error) {
    return archiveError(`Invalid or corrupted ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = Object.values(zip.files) as ZipObjectWithSize[];
  if (entries.length === 0) return archiveError("Skill ZIP is empty");
  if (entries.length > MAX_SKILL_ARCHIVE_ENTRIES) {
    return archiveError(`Skill ZIP cannot contain more than ${MAX_SKILL_ARCHIVE_ENTRIES} entries`);
  }

  let expandedBytes = 0;
  const seen = new Set<string>();
  const fileEntries: Array<{ path: string; entry: ZipObjectWithSize; mode?: number }> = [];
  for (const entry of entries) {
    const rawPath = entry.unsafeOriginalName ?? entry.name;
    const path = normalizedArchivePath(rawPath, entry.dir);
    const key = path.toLowerCase();
    if (seen.has(key)) return archiveError(`Archive contains duplicate paths: ${path}`);
    seen.add(key);
    const mode = unixMode(entry);
    if (mode !== undefined && (mode & 0o170000) === 0o120000) {
      return archiveError(`Symbolic links are not allowed in skill archives: ${path}`);
    }
    if (entry.dir) continue;
    const uncompressedSize = entry._data?.uncompressedSize;
    if (typeof uncompressedSize === "number") {
      if (uncompressedSize > MAX_SKILL_ARCHIVE_ENTRY_BYTES) {
        return archiveError(`Archive entry is too large: ${path}`);
      }
      expandedBytes += uncompressedSize;
      if (expandedBytes > MAX_SKILL_ARCHIVE_EXPANDED_BYTES) {
        return archiveError("Expanded skill ZIP must be 128MB or smaller");
      }
    }
    fileEntries.push({ path, entry, mode });
  }
  if (fileEntries.length === 0) return archiveError("Skill ZIP contains no files");

  const files: SkillArchiveFile[] = [];
  expandedBytes = 0;
  for (const item of fileEntries) {
    const remainingBytes = MAX_SKILL_ARCHIVE_EXPANDED_BYTES - expandedBytes;
    const entryLimit = Math.min(MAX_SKILL_ARCHIVE_ENTRY_BYTES, remainingBytes);
    const data = await readZipEntry(
      item.entry,
      item.path,
      entryLimit,
      entryLimit < MAX_SKILL_ARCHIVE_ENTRY_BYTES
        ? "Expanded skill ZIP must be 128MB or smaller"
        : `Archive entry is too large: ${item.path}`,
    );
    expandedBytes += data.byteLength;
    if (expandedBytes > MAX_SKILL_ARCHIVE_EXPANDED_BYTES) return archiveError("Expanded skill ZIP must be 128MB or smaller");
    files.push({ path: item.path, data, mode: item.mode });
  }

  const manifest = files.find((file) => file.path === INTEGRATION_MANIFEST);
  return manifest ? parseIntegration(files, manifest) : { kind: "skill", skill: requireSingleSkill(files) };
}
