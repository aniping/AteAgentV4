import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { MAX_SKILL_UPLOAD_REQUEST_BYTES } from "./lib/skill-archive-limits";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
const standaloneBuild = process.env.PI_WEB_STANDALONE === "1";
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  ...(standaloneBuild ? {
    output: "standalone" as const,
    outputFileTracingIncludes: {
      "/*": ["./node_modules/@earendil-works/pi-coding-agent/dist/**/*"],
    },
  } : {}),
  experimental: {
    proxyClientMaxBodySize: MAX_SKILL_UPLOAD_REQUEST_BYTES,
  },
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
