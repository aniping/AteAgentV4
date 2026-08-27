import type { NextConfig } from "next";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MAX_SKILL_UPLOAD_REQUEST_BYTES } from "./lib/skill-archive-limits.ts";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
const standaloneBuild = process.env.PI_WEB_STANDALONE === "1";

function collectPackageTraceGlobs(rootPackage: string): string[] {
  const packages = new Set<string>();
  const visit = (packageName: string): void => {
    if (packages.has(packageName)) return;
    const manifestPath = join(configDir, "node_modules", ...packageName.split("/"), "package.json");
    if (!existsSync(manifestPath)) return;

    packages.add(packageName);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const dependency of Object.keys(dependencies)) visit(dependency);
  };

  // Adapter 由 Pi 在运行时按路径加载，Next 无法从静态 import 自动追踪它的依赖闭包。
  visit(rootPackage);
  return [...packages].sort().map((packageName) => `./node_modules/${packageName}/**/*`);
}

const bundledMcpTraceGlobs = standaloneBuild ? collectPackageTraceGlobs("pi-mcp-adapter") : [];
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  ...(standaloneBuild ? {
    output: "standalone" as const,
    outputFileTracingIncludes: {
      "/*": ["./node_modules/@earendil-works/pi-coding-agent/dist/**/*", ...bundledMcpTraceGlobs],
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
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
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
