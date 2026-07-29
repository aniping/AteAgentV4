"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, "build");
const releaseRoot = path.join(buildRoot, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed with exit code ${result.status}.`);
  }
  return result;
}

function assertPathUnderBuildRoot(target) {
  const relative = path.relative(buildRoot, path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside the build root: ${target}`);
  }
}

function copyContents(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    fs.cpSync(path.join(source, entry), path.join(destination, entry), {
      recursive: true,
      force: true,
    });
  }
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function removeRedundantNestedPackage(topLevelPackage, nestedPackage) {
  if (!fs.existsSync(nestedPackage)) return;
  if (!fs.existsSync(topLevelPackage)) {
    throw new Error(`Cannot remove nested package because the top-level copy is missing: ${topLevelPackage}`);
  }

  const topManifest = JSON.parse(fs.readFileSync(path.join(topLevelPackage, "package.json"), "utf8"));
  const nestedManifest = JSON.parse(fs.readFileSync(path.join(nestedPackage, "package.json"), "utf8"));
  if (topManifest.name !== nestedManifest.name || topManifest.version !== nestedManifest.version) {
    throw new Error(
      `Refusing to remove a non-identical nested package: ${nestedManifest.name}@${nestedManifest.version}`,
    );
  }

  assertPathUnderBuildRoot(nestedPackage);
  fs.rmSync(nestedPackage, { recursive: true, force: true });
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function findExecutable(candidates, name) {
  for (const candidate of candidates.filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const where = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true });
  if (where.status === 0) {
    const match = where.stdout.split(/\r?\n/).find(Boolean);
    if (match && fs.existsSync(match)) return match;
  }
  return null;
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error(`Windows installers must be built on Windows; current platform is ${process.platform}.`);
  }
  if (!new Set(["x64", "arm64"]).has(process.arch)) {
    throw new Error(`Unsupported Windows installer architecture: ${process.arch}`);
  }

  const artifactName = `ate-agent-${packageJson.version}-win-${process.arch}`;
  const installerName = `ATE-Agent-Setup-${packageJson.version}-win-${process.arch}`;
  const stagingRoot = path.join(buildRoot, "installer", artifactName);
  const installerPath = path.join(releaseRoot, `${installerName}.exe`);
  const nodeArchiveName = `node-${process.version}-win-${process.arch}.zip`;
  const nodeCacheRoot = path.join(buildRoot, "node-runtime", `${process.version}-win-${process.arch}`);
  const nodeArchivePath = path.join(nodeCacheRoot, nodeArchiveName);
  const nodeChecksumsPath = path.join(nodeCacheRoot, "SHASUMS256.txt");
  const nodeExpandedRoot = path.join(nodeCacheRoot, "expanded");
  const nodeDistributionRoot = path.join(nodeExpandedRoot, path.parse(nodeArchiveName).name);

  for (const target of [stagingRoot, installerPath, nodeCacheRoot]) assertPathUnderBuildRoot(target);
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.mkdirSync(nodeCacheRoot, { recursive: true });
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.rmSync(installerPath, { force: true });

  const preloadPath = path.join(__dirname, "portable-build-preload.cjs").replaceAll("\\", "/");
  const buildEnv = {
    ...process.env,
    PI_WEB_STANDALONE: "1",
    PI_WEB_TRACE_ROOT: repoRoot,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=\"${preloadPath}\"`].filter(Boolean).join(" "),
  };
  run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build"], {
    cwd: repoRoot,
    env: buildEnv,
  });

  const standaloneRoot = path.join(repoRoot, ".next", "standalone");
  const staticRoot = path.join(repoRoot, ".next", "static");
  if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
    throw new Error(`Standalone server was not generated: ${path.join(standaloneRoot, "server.js")}`);
  }
  if (!fs.existsSync(staticRoot)) {
    throw new Error(`Next.js static assets were not generated: ${staticRoot}`);
  }

  const nodeBaseUrl = `https://nodejs.org/dist/${process.version}`;
  if (!fs.existsSync(nodeArchivePath)) {
    await downloadFile(`${nodeBaseUrl}/${nodeArchiveName}`, nodeArchivePath);
  }
  if (!fs.existsSync(nodeChecksumsPath)) {
    await downloadFile(`${nodeBaseUrl}/SHASUMS256.txt`, nodeChecksumsPath);
  }

  const checksumLine = fs
    .readFileSync(nodeChecksumsPath, "utf8")
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`  ${nodeArchiveName}`));
  if (!checksumLine) throw new Error(`Node.js checksum is missing for ${nodeArchiveName}.`);
  const expectedNodeHash = checksumLine.trim().split(/\s+/)[0].toLowerCase();
  const actualNodeHash = await sha256File(nodeArchivePath);
  if (actualNodeHash !== expectedNodeHash) {
    throw new Error(`Node.js archive checksum mismatch for ${nodeArchiveName}.`);
  }

  if (!fs.existsSync(path.join(nodeDistributionRoot, "node.exe"))) {
    fs.rmSync(nodeExpandedRoot, { recursive: true, force: true });
    fs.mkdirSync(nodeExpandedRoot, { recursive: true });
    const tar = findExecutable([path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")], "tar.exe");
    if (!tar) throw new Error("Windows tar.exe is required to extract the official Node.js distribution.");
    run(tar, ["-xf", nodeArchivePath, "-C", nodeExpandedRoot]);
  }
  if (!fs.existsSync(path.join(nodeDistributionRoot, "node_modules", "npm", "bin", "npx-cli.js"))) {
    throw new Error("Official Node.js distribution is missing npm/npx.");
  }

  const appRoot = path.join(stagingRoot, "app");
  const runtimeRoot = path.join(stagingRoot, "runtime");
  copyContents(standaloneRoot, appRoot);
  copyContents(staticRoot, path.join(appRoot, ".next", "static"));
  const publicRoot = path.join(repoRoot, "public");
  if (fs.existsSync(publicRoot)) fs.cpSync(publicRoot, path.join(appRoot, "public"), { recursive: true });

  removeRedundantNestedPackage(
    path.join(appRoot, "node_modules", "@mistralai", "mistralai"),
    path.join(
      appRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@mistralai",
      "mistralai",
    ),
  );

  copyContents(nodeDistributionRoot, runtimeRoot);
  fs.copyFileSync(path.join(nodeDistributionRoot, "LICENSE"), path.join(runtimeRoot, "NODE-LICENSE.txt"));
  fs.copyFileSync(path.join(__dirname, "portable-launcher.cjs"), path.join(stagingRoot, "launcher.cjs"));
  fs.copyFileSync(path.join(__dirname, "portable-start.cmd"), path.join(stagingRoot, "start.cmd"));
  fs.writeFileSync(path.join(runtimeRoot, "NODE-VERSION.txt"), `${process.version}\r\n`, "utf8");

  const csc = findExecutable(
    [
      path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ],
    "csc.exe",
  );
  if (!csc) throw new Error("The Windows .NET Framework C# compiler is required to build the server stop helper.");
  const stopHelperPath = path.join(stagingRoot, "stop-installed-server.exe");
  run(csc, [
    "/nologo",
    "/target:exe",
    "/optimize+",
    `/out:${stopHelperPath}`,
    path.join(__dirname, "stop-installed-server.cs"),
  ]);

  const packageReadme = `ATE Agent ${packageJson.version} Windows ${process.arch}\r\n\r\n` +
    `This installation includes Node.js ${process.version} with npm/npx; Node.js does not need to be installed separately.\r\n\r\n` +
    "Start:\r\n  Double-click start.cmd\r\n\r\n" +
    "Default address:\r\n  http://0.0.0.0:30141\r\n\r\n" +
    "Access from another computer on the same trusted network:\r\n  http://<this-computer-LAN-IP>:30141\r\n\r\n" +
    "Optional arguments:\r\n  start.cmd -H 127.0.0.1        Listen on this computer only\r\n" +
    "  start.cmd -H 0.0.0.0 -p 8080 Listen on all network interfaces with port 8080\r\n\r\n" +
    "Windows Defender Firewall may require an inbound rule for the selected port.\r\n" +
    "ATE Agent has no application-level authentication. Never expose it directly to the internet.\r\n";
  fs.writeFileSync(path.join(stagingRoot, "README.txt"), packageReadme, "utf8");

  const requiredFiles = [
    "start.cmd",
    "launcher.cjs",
    "stop-installed-server.exe",
    "runtime/node.exe",
    "runtime/npm.cmd",
    "runtime/npx.cmd",
    "runtime/node_modules/npm/bin/npm-cli.js",
    "runtime/node_modules/npm/bin/npx-cli.js",
    "runtime/NODE-LICENSE.txt",
    "app/server.js",
    "app/.next/BUILD_ID",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/light.json",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.html",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.css",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/marked.min.js",
    "app/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/assets/clankolas.png",
  ];
  for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(stagingRoot, required))) {
      throw new Error(`Installer payload entry is missing: ${required}`);
    }
  }

  const relativePaths = listFiles(stagingRoot).map((file) => path.relative(stagingRoot, file));
  const longestRelativePath = relativePaths.sort((a, b) => b.length - a.length)[0];
  const defaultLongestPath = path.join("C:\\Program Files\\ATE Agent", longestRelativePath);
  if (defaultLongestPath.length >= 260) {
    throw new Error(`Installer payload still exceeds the Windows MAX_PATH limit: ${defaultLongestPath}`);
  }
  const maxInstallDirLength = 258 - longestRelativePath.length;

  const makensis = findExecutable(
    [
      process.env.NSIS_MAKENSIS,
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "NSIS", "makensis.exe"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "NSIS", "makensis.exe"),
    ],
    "makensis.exe",
  );
  if (!makensis) {
    throw new Error("NSIS 3 is required. Install it with: winget install --id NSIS.NSIS -e");
  }

  const versionMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);
  if (!versionMatch) {
    throw new Error(`Package version cannot be converted to a Windows file version: ${packageJson.version}`);
  }
  const windowsVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}.0`;
  run(makensis, [
    "/V2",
    `/DAPP_VERSION=${packageJson.version}`,
    `/DAPP_FILE_VERSION=${windowsVersion}`,
    `/DAPP_ARCH=${process.arch}`,
    `/DSOURCE_ROOT=${stagingRoot}`,
    `/DOUTPUT_FILE=${installerPath}`,
    `/DMAX_INSTALL_DIR_LENGTH=${maxInstallDirLength}`,
    path.join(__dirname, "windows-installer.nsi"),
  ]);
  if (!fs.existsSync(installerPath)) throw new Error(`NSIS did not generate the installer: ${installerPath}`);

  const installerSize = fs.statSync(installerPath).size;
  console.log(`Windows installer: ${installerPath}`);
  console.log(`Embedded Node.js with npm/npx: ${process.version} (${process.arch})`);
  console.log(`Installer size: ${(installerSize / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`Longest installed path at the default location: ${defaultLongestPath.length} characters`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
