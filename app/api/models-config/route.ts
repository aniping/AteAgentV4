import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { normalizeModelsConfig, type ModelsConfig } from "@/lib/models-config";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-file";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as ModelsConfig;
    const config = normalizeModelsConfig(body);
    writeModelsConfig(config);
    invalidateModelsCache();
    return NextResponse.json({ success: true, config });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
