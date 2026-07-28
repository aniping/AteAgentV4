import { NextResponse } from "next/server";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import { isApiRequestAllowed } from "@/lib/request-security";
import {
  MAX_SKILL_ARCHIVE_BYTES,
  parseSkillArchive,
  SkillArchiveConflictError,
  SkillArchiveError,
} from "@/lib/skill-archive";
import { installSkillArchive, type SkillArchiveInstallScope } from "@/lib/skill-archive-install";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_REQUEST_BYTES = MAX_SKILL_ARCHIVE_BYTES + 2 * 1024 * 1024;
const MCP_ADAPTER_SOURCE = "npm:pi-mcp-adapter";

function isMultipartRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "multipart/form-data";
}

function isMcpAdapterSource(source: string): boolean {
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

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!isMultipartRequest(request)) {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 415 });
  }

  try {
    let form: FormData;
    try {
      form = await parseFormDataWithinLimit(request, MAX_UPLOAD_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Skill ZIP must be 50MB or smaller" }, { status: 413 });
      }
      throw error;
    }

    const fileEntries = form.getAll("file").filter((entry): entry is File => typeof entry !== "string");
    if (fileEntries.length !== 1) {
      return NextResponse.json({ error: "Exactly one skill ZIP is required" }, { status: 400 });
    }
    const file = fileEntries[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Skill archive filename must end in .zip" }, { status: 400 });
    }
    if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
      return NextResponse.json({ error: "Skill ZIP must be 50MB or smaller" }, { status: 413 });
    }
    const scopeValue = form.get("scope");
    if (scopeValue !== "global" && scopeValue !== "project") {
      return NextResponse.json({ error: "scope must be global or project" }, { status: 400 });
    }
    const scope: SkillArchiveInstallScope = scopeValue;
    const cwdValue = form.get("cwd");
    const cwd = typeof cwdValue === "string" ? cwdValue.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const projectTrust = getProjectTrustStatus(cwd, agentDir);
    if (scope === "project" && !projectTrust.trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before installing project skills" },
        { status: 403 },
      );
    }

    const archive = await parseSkillArchive(Buffer.from(await file.arrayBuffer()));
    const result = await installSkillArchive(archive, {
      scope,
      cwd,
      agentDir,
      async ensureMcpSupport() {
        const settingsManager = SettingsManager.create(cwd, agentDir, {
          projectTrusted: projectTrust.trusted,
        });
        const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
        const resolved = await packageManager.resolve(async () => "skip" as const);
        if (hasUsableMcpAdapter(resolved.extensions, scope)) {
          return false;
        }
        const configured = packageManager.listConfiguredPackages();
        const requestedScope = scope === "project" ? "project" : "user";
        const requested = configured.find(
          (pkg) => pkg.scope === requestedScope && isMcpAdapterSource(pkg.source),
        );
        await packageManager.installAndPersist(requested?.source ?? MCP_ADAPTER_SOURCE, {
          local: scope === "project",
        });
        if (scope === "project") trustProject(cwd, agentDir);
        const installed = await packageManager.resolve(async () => "skip" as const);
        if (!hasUsableMcpAdapter(installed.extensions, scope)) {
          throw new SkillArchiveError(`pi-mcp-adapter is disabled or filtered in the ${scope} scope`);
        }
        return true;
      },
    });
    if (scope === "project") trustProject(cwd, agentDir);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SkillArchiveConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof SkillArchiveError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
