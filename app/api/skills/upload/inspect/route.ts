import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import type { SkillArchiveInspectionResponse } from "@/lib/api-types";
import { isApiRequestAllowed } from "@/lib/request-security";
import { inspectSkillArchive, SkillArchiveError } from "@/lib/skill-archive-inspection";
import {
  MAX_SKILL_ARCHIVE_BYTES,
  MAX_SKILL_ARCHIVE_LABEL,
  MAX_SKILL_UPLOAD_REQUEST_BYTES,
} from "@/lib/skill-archive-limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isMultipartRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "multipart/form-data";
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
        return NextResponse.json(
          { error: `Skill ZIP must be ${MAX_SKILL_ARCHIVE_LABEL} or smaller` },
          { status: 413 },
        );
      }
      throw error;
    }

    const files = form.getAll("file").filter((entry): entry is File => typeof entry !== "string");
    if (files.length !== 1) {
      return NextResponse.json({ error: "Exactly one skill ZIP is required" }, { status: 400 });
    }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Skill archive filename must end in .zip" }, { status: 400 });
    }
    if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
      return NextResponse.json(
        { error: `Skill ZIP must be ${MAX_SKILL_ARCHIVE_LABEL} or smaller` },
        { status: 413 },
      );
    }

    const { inspection } = await inspectSkillArchive(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ inspection } satisfies SkillArchiveInspectionResponse);
  } catch (error) {
    if (error instanceof SkillArchiveError) {
      return NextResponse.json({ error: "Invalid skill ZIP" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to inspect skill ZIP" }, { status: 500 });
  }
}
