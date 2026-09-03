import { createHash, timingSafeEqual } from "node:crypto";
import type { SkillArchiveInspection, SkillArchiveRisk } from "./api-types";
import {
  parseSkillArchive,
  SkillArchiveConflictError,
  SkillArchiveError,
  type ParsedSkillArchive,
  type SkillArchiveFile,
} from "./skill-archive";

export { SkillArchiveConflictError, SkillArchiveError };

export interface InspectedSkillArchive {
  archive: ParsedSkillArchive;
  inspection: SkillArchiveInspection;
}

export class SkillArchiveConfirmationError extends SkillArchiveError {}

function archiveFiles(archive: ParsedSkillArchive): SkillArchiveFile[] {
  return archive.kind === "integration" ? archive.files : archive.skill.files;
}

function archiveRisk(archive: ParsedSkillArchive): SkillArchiveRisk {
  if (archive.kind === "integration") return "integration-runtime";
  return archive.skill.files.length === 1
    ? "instructions-only"
    : "supporting-files";
}

export async function inspectSkillArchive(
  input: Buffer | Uint8Array,
): Promise<InspectedSkillArchive> {
  const archive = await parseSkillArchive(input);
  const files = archiveFiles(archive);
  const inspection: SkillArchiveInspection = {
    sha256: createHash("sha256").update(input).digest("hex"),
    kind: archive.kind,
    risk: archiveRisk(archive),
    skill: {
      name: archive.skill.name,
      description: archive.skill.description,
      fileCount: archive.skill.files.length,
    },
    archive: {
      fileCount: files.length,
      expandedBytes: files.reduce((total, file) => total + file.data.byteLength, 0),
    },
  };

  if (archive.kind === "integration") {
    inspection.integration = {
      id: archive.id,
      version: archive.version,
      ...(archive.mcp
        ? {
            mcp: {
              serverName: archive.mcp.serverName,
              executable: archive.mcp.executable,
              requiredTools: [...(archive.mcp.requiredTools ?? [])],
              environmentNames: Object.keys(archive.mcp.env ?? {}).sort(),
            },
          }
        : {}),
    };
  }

  return { archive, inspection };
}

export function assertSkillArchiveInstallConfirmation(
  inspection: SkillArchiveInspection,
  expectedSha256: unknown,
  riskAcknowledged: boolean,
): void {
  if (typeof expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    throw new SkillArchiveConfirmationError(
      "expectedSha256 must be the 64-character SHA-256 returned by inspection",
    );
  }
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(inspection.sha256, "hex");
  if (!timingSafeEqual(expected, actual)) {
    throw new SkillArchiveConfirmationError(
      "Skill ZIP changed after inspection; inspect it again before installing",
    );
  }
  if (inspection.risk !== "instructions-only" && !riskAcknowledged) {
    throw new SkillArchiveConfirmationError(
      "riskAcknowledged=true is required for archives with supporting files or integration runtime",
    );
  }
}
