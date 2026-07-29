import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { getDefaultCwdName } from "@/lib/default-cwd";

// POST /api/default-cwd
// Creates ~/ate-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  try {
    const dir = join(homedir(), getDefaultCwdName());
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
