import { NextResponse } from "next/server";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { hasUsableMcpAdapter, isMcpAdapterSource, MCP_ADAPTER_SOURCE } from "@/lib/mcp-adapter";
import {
  parseSkillArchive,
  SkillArchiveConflictError,
  SkillArchiveError,
} from "@/lib/skill-archive";
import {
  MAX_SKILL_ARCHIVE_BYTES,
  MAX_SKILL_ARCHIVE_LABEL,
  MAX_SKILL_UPLOAD_REQUEST_BYTES,
} from "@/lib/skill-archive-limits";
import {
  installSkillArchive,
  type SkillArchiveInstallScope,
  uninstallSkillArchive,
} from "@/lib/skill-archive-install";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isMultipartRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "multipart/form-data";
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
      form = await parseFormDataWithinLimit(request, MAX_SKILL_UPLOAD_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: `Skill ZIP must be ${MAX_SKILL_ARCHIVE_LABEL} or smaller` }, { status: 413 });
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
      return NextResponse.json({ error: `Skill ZIP must be ${MAX_SKILL_ARCHIVE_LABEL} or smaller` }, { status: 413 });
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

export async function DELETE(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await request.json() as {
      cwd?: unknown;
      scope?: unknown;
      skillName?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const scope = body.scope === "global" || body.scope === "project"
      ? body.scope as SkillArchiveInstallScope
      : undefined;
    const skillName = typeof body.skillName === "string" ? body.skillName : "";
    if (!cwd || !scope || !skillName) {
      return NextResponse.json({ error: "cwd, scope, and skillName are required" }, { status: 400 });
    }
    if (skillName.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
      return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const agentDir = getAgentDir();
    if (scope === "project" && !getProjectTrustStatus(cwd, agentDir).trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before uninstalling project skills" },
        { status: 403 },
      );
    }

    const result = await uninstallSkillArchive(skillName, { scope, cwd, agentDir });
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
