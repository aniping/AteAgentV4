import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parsePortableLaunchOptions } = require("./portable-launcher.cjs");

test("portable package listens on the trusted LAN by default", () => {
  assert.deepEqual(parsePortableLaunchOptions([], {}), {
    hostname: "0.0.0.0",
    port: 30141,
  });
});

test("portable package accepts hostname and port overrides", () => {
  assert.deepEqual(
    parsePortableLaunchOptions(["-H", "127.0.0.1", "-p", "41000"], {}),
    { hostname: "127.0.0.1", port: 41000 },
  );
});

test("portable package supports explicit environment configuration", () => {
  assert.deepEqual(
    parsePortableLaunchOptions([], {
      PI_WEB_HOSTNAME: "192.168.1.20",
      PORT: "8080",
    }),
    { hostname: "192.168.1.20", port: 8080 },
  );
});

test("portable package rejects invalid launch values", () => {
  assert.throws(() => parsePortableLaunchOptions(["-H", "  "], {}), /hostname/);
  assert.throws(() => parsePortableLaunchOptions(["-p", "70000"], {}), /port/);
});

test("portable startup exposes the bundled npm tools to child processes", async () => {
  const startScript = await readFile(new URL("./portable-start.cmd", import.meta.url), "utf8");

  assert.match(startScript, /set "PATH=%~dp0runtime\\node;%PATH%"/);
  assert.match(startScript, /"%~dp0ATE-Agent\.exe" %\*/);
  assert.doesNotMatch(startScript, /runtime\\node\\node\.exe/);
});

test("Windows package builds an ATE Agent NSIS installer", async () => {
  const [packageJson, packageCommand, packageScript, installerScript, launcherSource, stopSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("./package-installer.cmd", import.meta.url), "utf8"),
    readFile(new URL("./package-installer.cjs", import.meta.url), "utf8"),
    readFile(new URL("./windows-installer.nsi", import.meta.url), "utf8"),
    readFile(new URL("./ate-agent-launcher.cs", import.meta.url), "utf8"),
    readFile(new URL("./stop-all-server.cs", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(packageJson).scripts.package, "scripts\\package-installer.cmd");
  assert.match(packageCommand, /node\.exe?"? "%~dp0package-installer\.cjs"/i);
  assert.match(packageScript, /ATE-Agent-Setup-/);
  assert.match(packageScript, /removeRedundantNestedPackage/);
  assert.match(packageScript, /pruneInstallerPayload/);
  assert.match(packageScript, /makensis/i);
  assert.match(installerScript, /WriteUninstaller/);
  assert.match(installerScript, /InstallDir "\$PROGRAMFILES64\\ATEAgent"/);
  assert.match(installerScript, /CreateShortcut[^\r\n]+ATE-Agent\.exe/);
  assert.match(installerScript, /RequestExecutionLevel admin/);
  assert.match(installerScript, /stop-all-server\.exe/);
  assert.match(installerScript, /RMDir \/r "\$INSTDIR\\app"/);
  assert.match(installerScript, /RMDir \/r "\$INSTDIR\\runtime"/);
  assert.match(installerScript, /RMDir \/r "\$INSTDIR\\support"/);
  assert.match(installerScript, /MUI_FINISHPAGE_RUN "\$INSTDIR\\ATE-Agent\.exe"/);
  assert.doesNotMatch(installerScript, /MUI_FINISHPAGE_RUN_NOTCHECKED/);
  assert.doesNotMatch(installerScript, /[^\x00-\x7F]/);
  assert.match(packageScript, /win32icon/i);
  assert.match(packageScript, /System\.Drawing\.dll/);
  assert.match(launcherSource, /runtime[\\]node[\\]node\.exe/);
  assert.match(launcherSource, /support[\\]launcher\.cjs/);
  assert.match(launcherSource, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcherSource, /CREATE_SUSPENDED/);
  assert.match(launcherSource, /CreateProcess/);
  assert.match(launcherSource, /AssignProcessToJobObject/);
  assert.match(launcherSource, /ResumeThread/);
  assert.match(launcherSource, /WaitForSingleObject/);
  assert.match(launcherSource, /Application\.Run/);
  assert.match(launcherSource, /NotifyIcon/);
  assert.match(launcherSource, /MouseDoubleClick/);
  assert.match(launcherSource, /OpenWebInterface/);
  assert.match(launcherSource, /OpenWebInterfaceWhenReady/);
  assert.match(launcherSource, /SingleInstance/);
  assert.match(launcherSource, /ShowStatusSignal/);
  assert.match(launcherSource, /RestartServer/);
  assert.match(launcherSource, /ShowStatusWindow/);
  assert.match(launcherSource, /SetCurrentProcessExplicitAppUserModelID/);
  assert.match(launcherSource, /AssemblyTitle\("ATE Agent"\)/);
  assert.match(launcherSource, /AssemblyProduct\("ATE Agent"\)/);
  assert.doesNotMatch(launcherSource, /WaitForSingleObject\(process\.hProcess, INFINITE\)/);
  assert.match(stopSource, /ATE-Agent\.exe/);
  assert.match(stopSource, /runtime[\\]node[\\]node\.exe/);
  assert.match(stopSource, /AppDomain\.CurrentDomain\.BaseDirectory/);
  assert.match(stopSource, /MainModule\.FileName/);
  assert.match(stopSource, /\/T/);
  assert.match(stopSource, /ManagementObjectSearcher/);
  assert.match(stopSource, /InvokeMethod\("Terminate"/);
  assert.match(packageScript, /System\.Management\.dll/);
  assert.match(packageScript, /app\/node_modules\/@earendil-works\/pi-coding-agent\/package\.json/);
  assert.match(packageScript, /support\/launcher\.cjs/);
  assert.doesNotMatch(
    [packageJson, packageCommand, packageScript, installerScript, launcherSource, stopSource].join("\n"),
    /pwsh|powershell|\.ps1/i,
  );
});

test("ATE Agent starts with its status window and hides to the tray when closed", async () => {
  const launcherSource = await readFile(new URL("./ate-agent-launcher.cs", import.meta.url), "utf8");

  assert.match(launcherSource, /LauncherForm\s*:\s*Form/);
  assert.match(launcherSource, /Application\.Run\(form\)/);
  assert.doesNotMatch(launcherSource, /OnLoad\(EventArgs e\)\s*\{[^}]*HideToTray\(\)/);
  assert.doesNotMatch(launcherSource, /OnLoad\(EventArgs e\)\s*\{[^}]*OpenWebInterface/);
  assert.match(launcherSource, /ShowInTaskbar\s*=\s*true/);
  assert.match(launcherSource, /ShowStatusWindow\(\)[\s\S]*?Show\(\)/);
  assert.match(launcherSource, /HideToTray\(\)[\s\S]*?Hide\(\)/);
  assert.doesNotMatch(launcherSource, /HideToTray\(\)[\s\S]*?ShowInTaskbar\s*=\s*false/);
  assert.match(launcherSource, /FormClosing/);
  assert.match(launcherSource, /e\.Cancel\s*=\s*true/);
  assert.doesNotMatch(launcherSource, /ApplicationContext/);
  assert.match(launcherSource, /OnShowStatusSignal[\s\S]*?ShowStatusWindow\(\)/);
  assert.doesNotMatch(launcherSource, /OnOpenWebSignal/);
});

test("ATE Agent binds a ContextMenuStrip to its tray icon", async () => {
  const launcherSource = await readFile(new URL("./ate-agent-launcher.cs", import.meta.url), "utf8");

  assert.match(launcherSource, /new ContextMenuStrip\(\)/);
  assert.match(launcherSource, /ContextMenuStrip\s*=\s*menu/);
  assert.match(launcherSource, /MouseDoubleClick[\s\S]*?ShowStatusWindow\(\)/);
  assert.doesNotMatch(launcherSource, /MouseUp/);
  assert.doesNotMatch(launcherSource, /new ContextMenu\(\)/);
});

test("ATE Agent status window shows separate Agent and UI versions", async () => {
  const [launcherSource, packageScript] = await Promise.all([
    readFile(new URL("./ate-agent-launcher.cs", import.meta.url), "utf8"),
    readFile(new URL("./package-installer.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(launcherSource, /AGENT\s+v" \+ BuildVersions\.Agent/);
  assert.match(launcherSource, /UI\s+v" \+ BuildVersions\.Ui/);
  assert.match(packageScript, /internal const string Agent/);
  assert.match(packageScript, /internal const string Ui/);
  assert.match(packageScript, /agentPackageJson\.version/);
  assert.match(packageScript, /ATE\.Agent\.Brand\.png/);
  assert.match(launcherSource, /GetManifestResourceStream\("ATE\.Agent\.Brand\.png"\)/);
});

test("ATE Agent opens the browser without blocking its UI thread", async () => {
  const launcherSource = await readFile(new URL("./ate-agent-launcher.cs", import.meta.url), "utf8");

  assert.match(launcherSource, /LinkClicked[\s\S]*?OpenWebInterfaceWhenReady\(\)/);
  assert.match(launcherSource, /SpecialFolder\.Windows/);
  assert.match(launcherSource, /explorer\.exe/);
  assert.match(launcherSource, /UseShellExecute\s*=\s*false/);
  assert.doesNotMatch(launcherSource, /BeginInvoke\(\(MethodInvoker\)delegate\s*\{\s*OpenWebInterface\(\)/);
});
