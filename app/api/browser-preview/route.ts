import { NextResponse } from "next/server";
import {
  BrowserPreviewProxyError,
  createBrowserPreviewUrl,
} from "@/lib/browser-preview-proxy";
import { normalizeBrowserAddress } from "@/lib/browser-tab-state";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function externalRequestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") ?? requestUrl.host;
  return `${requestUrl.protocol}//${host}`;
}

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return errorResponse("Untrusted API request", 403);
  }
  if (!hasJsonContentType(request)) {
    return errorResponse("Content-Type must be application/json", 415);
  }

  let rawUrl: unknown;
  try {
    rawUrl = (await request.json() as { url?: unknown }).url;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (typeof rawUrl !== "string") {
    return errorResponse("url is required", 400);
  }

  const parentOrigin = externalRequestOrigin(request);
  const normalized = normalizeBrowserAddress(rawUrl, parentOrigin);
  if (!normalized.ok) {
    return errorResponse(`Invalid preview URL: ${normalized.error}`, 400);
  }

  try {
    const previewUrl = await createBrowserPreviewUrl(normalized.url, {
      parentOrigin,
      forbiddenOrigins: [parentOrigin],
    });
    return NextResponse.json(
      { previewUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BrowserPreviewProxyError) {
      const status = error.code === "target-unroutable" || error.code === "recursive-target"
        ? 403
        : error.code === "target-unresolved"
          ? 502
          : error.code === "invalid-target"
            ? 400
            : 500;
      return errorResponse(error.code, status);
    }
    return errorResponse("proxy-start-failed", 500);
  }
}
