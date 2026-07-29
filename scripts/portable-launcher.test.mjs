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

  assert.match(startScript, /set "PATH=%~dp0runtime;%PATH%"/);
});

test("Windows package builds an ATE Agent NSIS installer", async () => {
  const [packageJson, packageCommand, packageScript, installerScript, stopSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("./package-installer.cmd", import.meta.url), "utf8"),
    readFile(new URL("./package-installer.cjs", import.meta.url), "utf8"),
    readFile(new URL("./windows-installer.nsi", import.meta.url), "utf8"),
    readFile(new URL("./stop-installed-server.cs", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(packageJson).scripts.package, "scripts\\package-installer.cmd");
  assert.match(packageCommand, /node\.exe?"? "%~dp0package-installer\.cjs"/i);
  assert.match(packageScript, /ATE-Agent-Setup-/);
  assert.match(packageScript, /removeRedundantNestedPackage/);
  assert.match(packageScript, /makensis/i);
  assert.match(installerScript, /WriteUninstaller/);
  assert.match(installerScript, /CreateShortcut/);
  assert.match(installerScript, /RequestExecutionLevel admin/);
  assert.match(installerScript, /stop-installed-server\.exe/);
  assert.doesNotMatch(installerScript, /[^\x00-\x7F]/);
  assert.match(stopSource, /MainModule\.FileName/);
  assert.match(stopSource, /process\.Kill\(\)/);
  assert.doesNotMatch(
    [packageJson, packageCommand, packageScript, installerScript, stopSource].join("\n"),
    /pwsh|powershell|\.ps1/i,
  );
});
