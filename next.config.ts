import type { NextConfig } from "next";
import { existsSync, readFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { MAX_SKILL_UPLOAD_REQUEST_BYTES } from "./lib/skill-archive-limits.ts";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
const standaloneBuild = process.env.PI_WEB_STANDALONE === "1";

function collectPackageTraceGlobs(rootPackage: string): string[] {
  const manifests = new Set<string>();
  const resolveDependencyManifest = (packageName: string, fromManifest: string): string | null => {
    let currentDir = dirname(fromManifest);
    while (true) {
      const manifestPath = join(currentDir, "node_modules", ...packageName.split("/"), "package.json");
      if (existsSync(manifestPath)) return manifestPath;

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) return null;
      currentDir = parentDir;
    }
  };
  const visit = (manifestPath: string): void => {
    if (manifests.has(manifestPath) || !existsSync(manifestPath)) return;

    manifests.add(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const dependency of Object.keys(dependencies)) {
      const dependencyManifest = resolveDependencyManifest(dependency, manifestPath);
      if (dependencyManifest) visit(dependencyManifest);
    }
  };

  // 内置扩展由 Pi 在运行时按路径加载，Next 无法从静态 import 自动追踪其依赖闭包。
  visit(join(configDir, "node_modules", ...rootPackage.split("/"), "package.json"));
  return [...manifests]
    .map((manifestPath) => `./${relative(configDir, dirname(manifestPath)).replaceAll("\\", "/")}/**/*`)
    .sort();
}

const bundledExtensionTraceGlobs = standaloneBuild
  ? [...new Set([
      ...collectPackageTraceGlobs("pi-mcp-adapter"),
      ...collectPackageTraceGlobs("@tintinweb/pi-subagents"),
      ...collectPackageTraceGlobs("jiti"),
    ])]
  : [];
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
      "/*": ["./node_modules/@earendil-works/pi-coding-agent/dist/**/*", ...bundledExtensionTraceGlobs],
    },
  } : {}),
  experimental: {
    proxyClientMaxBodySize: MAX_SKILL_UPLOAD_REQUEST_BYTES,
  },
  serverExternalPackages: [
    "undici",
    "jiti",
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
