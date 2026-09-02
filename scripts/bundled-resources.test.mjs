import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  copyBundledResources,
  validateBundledResources,
  validateBundledSkills,
} = require("./bundled-resources.cjs");
const sourceRoot = resolve(import.meta.dirname, "../bundled-resources");

function writeSkill(skillRoot, directoryName, name, description = `${name} test skill`) {
  const directory = join(skillRoot, directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function createPeRuntime(machine = 0x8664, { characteristics = 0x0002, optionalMagic = 0x20b } = {}) {
  const runtime = Buffer.alloc(1024);
  const peOffset = 0x80;
  runtime.write("MZ", 0, "ascii");
  runtime.writeUInt32LE(peOffset, 0x3c);
  runtime.write("PE\0\0", peOffset, "binary");
  runtime.writeUInt16LE(machine, peOffset + 4);
  runtime.writeUInt16LE(1, peOffset + 6);
  runtime.writeUInt16LE(0xf0, peOffset + 20);
  runtime.writeUInt16LE(characteristics, peOffset + 22);
  runtime.writeUInt16LE(optionalMagic, peOffset + 24);
  runtime.write(".text\0\0\0", peOffset + 24 + 0xf0, "binary");
  return runtime;
}

function writeFixtureFile(root, relativePath, contents) {
  const destination = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
  return destination;
}

function createBreakhubBundleFixture(
  bundleRoot,
  { machine = 0x8664, characteristics = 0x0002, optionalMagic = 0x20b } = {},
) {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, "bundle.json"), "utf8"));
  manifest.scenes = manifest.scenes.map((scene) => ({
    ...scene,
    mcpPaths: scene.id === "integration" ? ["scenes/integration/mcp"] : [],
  }));
  mkdirSync(bundleRoot, { recursive: true });
  writeFileSync(join(bundleRoot, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  for (const scene of manifest.scenes) {
    writeFixtureFile(bundleRoot, scene.instructions, `# ${scene.agentName}\n`);
    for (const skillPath of scene.skillPaths) {
      writeSkill(join(bundleRoot, ...skillPath.split("/")), `${scene.id}-fixture`, `${scene.id}-fixture`);
    }
  }

  const integrationManifest = {
    schemaVersion: 1,
    id: "breakhub",
    version: "0.1.0",
    platform: "win32",
    arch: "x64",
    mcp: {
      serverName: "microbreakpoint",
      executable: "runtime/win-x64/breakhub-mcp.exe",
      lifecycle: "lazy",
    },
  };
  const mcpRoot = join(bundleRoot, "scenes", "integration", "mcp", "breakhub");
  const fixtureFiles = new Map([
    ["integration.json", `${JSON.stringify(integrationManifest, null, 2)}\n`],
    ["runtime/win-x64/breakhub-mcp.exe", createPeRuntime(machine, { characteristics, optionalMagic })],
  ]);
  for (const [relativePath, contents] of fixtureFiles) {
    writeFixtureFile(mcpRoot, relativePath, contents);
  }
  writeFixtureFile(
    mcpRoot,
    "SHA256SUMS.json",
    `${JSON.stringify({
      schemaVersion: 1,
      files: Object.fromEntries(
        [...fixtureFiles].map(([relativePath, contents]) => [relativePath, sha256(contents)]),
      ),
    }, null, 2)}\n`,
  );

  return {
    manifestPath: join(mcpRoot, "integration.json"),
    mcpRoot,
    runtimePath: join(mcpRoot, "runtime", "win-x64", "breakhub-mcp.exe"),
  };
}

function refreshFixtureManifestChecksum(mcpRoot) {
  const checksumPath = join(mcpRoot, "SHA256SUMS.json");
  const checksums = JSON.parse(readFileSync(checksumPath, "utf8"));
  checksums.files["integration.json"] = sha256(readFileSync(join(mcpRoot, "integration.json")));
  writeFileSync(checksumPath, `${JSON.stringify(checksums, null, 2)}\n`, "utf8");
}

test("bundled resources validate and copy into the standalone app root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-bundle-"));
  try {
    const appRoot = join(tempRoot, "app");
    const manifest = await validateBundledResources(sourceRoot);
    assert.deepEqual(manifest.scenes.map((scene) => scene.id), [
      "requirements", "design", "development", "integration", "testing",
    ]);
    const destination = await copyBundledResources(sourceRoot, appRoot);
    assert.deepEqual(
      JSON.parse(readFileSync(join(destination, "bundle.json"), "utf8")),
      manifest,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(
        destination,
        "scenes",
        "integration",
        "mcp",
        "breakhub",
        "runtime",
        "win-x64",
        "breakhub_targets.json",
      ), "utf8")),
      { version: 2, connections: [] },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a resource path outside the bundle root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-bundle-invalid-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const manifestPath = join(bundleRoot, "bundle.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scenes[0].instructions = "../outside/AGENTS.md";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    await assert.rejects(() => validateBundledResources(bundleRoot), /escapes bundle root/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects an MCP root outside the bundle root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-root-escape-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    createBreakhubBundleFixture(bundleRoot);
    const manifestPath = join(bundleRoot, "bundle.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scenes.find((scene) => scene.id === "integration").mcpPaths = ["../outside-mcp"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /MCP.*escapes bundle root|escapes bundle root.*MCP/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a filesystem link in an MCP root ancestor", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-ancestor-link-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    createBreakhubBundleFixture(bundleRoot);
    const originalMcpRoot = join(bundleRoot, "scenes", "integration", "mcp");
    const realParent = join(bundleRoot, "mcp-real-parent");
    const linkedParent = join(bundleRoot, "scenes", "integration", "mcp-linked-parent");
    mkdirSync(realParent, { recursive: true });
    renameSync(originalMcpRoot, join(realParent, "mcp"));
    symlinkSync(realParent, linkedParent, "junction");

    const manifestPath = join(bundleRoot, "bundle.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scenes.find((scene) => scene.id === "integration").mcpPaths = [
      "scenes/integration/mcp-linked-parent/mcp",
    ];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /MCP.*filesystem link|filesystem link.*MCP/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a malformed bundled MCP manifest", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-manifest-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const fixture = createBreakhubBundleFixture(bundleRoot);
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    manifest.schemaVersion = 2;
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refreshFixtureManifestChecksum(fixture.mcpRoot);

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /integration\.json|MCP manifest|schema/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a missing bundled MCP runtime", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-runtime-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const fixture = createBreakhubBundleFixture(bundleRoot);
    rmSync(fixture.runtimePath);

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /breakhub-mcp\.exe|MCP runtime|missing/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a bundled MCP checksum mismatch", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-checksum-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const fixture = createBreakhubBundleFixture(bundleRoot);
    const runtime = readFileSync(fixture.runtimePath);
    runtime[runtime.length - 1] ^= 1;
    writeFileSync(fixture.runtimePath, runtime);

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /SHA-?256|checksum|digest|hash/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a bundled MCP executable path escape", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-runtime-escape-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const fixture = createBreakhubBundleFixture(bundleRoot);
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    manifest.mcp.executable = "../outside/breakhub-mcp.exe";
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refreshFixtureManifestChecksum(fixture.mcpRoot);

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /MCP executable.*escape|path.*escape|outside.*MCP/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a bundled MCP runtime with the wrong PE architecture", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-architecture-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    createBreakhubBundleFixture(bundleRoot, { machine: 0xaa64 });

    await assert.rejects(
      () => validateBundledResources(bundleRoot),
      /architecture|machine|x64|arm64/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects a non-executable or non-PE32+ MCP image", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-invalid-pe-"));
  try {
    const nonExecutableRoot = join(tempRoot, "non-executable");
    createBreakhubBundleFixture(nonExecutableRoot, { characteristics: 0 });
    await assert.rejects(
      () => validateBundledResources(nonExecutableRoot),
      /executable PE32\+ image/i,
    );

    const pe32Root = join(tempRoot, "pe32");
    createBreakhubBundleFixture(pe32Root, { optionalMagic: 0x10b });
    await assert.rejects(
      () => validateBundledResources(pe32Root),
      /executable PE32\+ image/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundle validation rejects an installer architecture unsupported by the bundled MCP", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-mcp-target-architecture-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    createBreakhubBundleFixture(bundleRoot);

    await validateBundledResources(bundleRoot, { targetPlatform: "win32", targetArch: "x64" });
    await assert.rejects(
      () => validateBundledResources(bundleRoot, { targetPlatform: "win32", targetArch: "arm64" }),
      /targets x64, not arm64/i,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Skill validation keeps the five scene skill sets isolated", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-skills-isolated-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const sceneIds = ["requirements", "design", "development", "integration", "testing"];
    for (const sceneId of sceneIds) {
      writeSkill(join(bundleRoot, "scenes", sceneId, "skills"), `${sceneId}-company`, `${sceneId}-company`);
    }

    const summary = await validateBundledSkills(bundleRoot);
    assert.deepEqual(
      summary,
      sceneIds.map((sceneId) => ({
        sceneId,
        skillNames: sceneId === "integration"
          ? ["breakpoint-debugging", "integration-company"]
          : [`${sceneId}-company`],
      })),
    );

    const destination = await copyBundledResources(bundleRoot, join(tempRoot, "app"));
    for (const sceneId of sceneIds) {
      assert.equal(
        existsSync(join(destination, "scenes", sceneId, "skills", `${sceneId}-company`, "SKILL.md")),
        true,
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("copy rejects a malformed Skill before writing the app payload", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-skills-invalid-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const appRoot = join(tempRoot, "app");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const invalidSkillRoot = join(bundleRoot, "scenes", "requirements", "skills", "invalid-skill");
    mkdirSync(invalidSkillRoot, { recursive: true });
    writeFileSync(join(invalidSkillRoot, "SKILL.md"), "# Missing frontmatter\n", "utf8");

    await assert.rejects(
      () => copyBundledResources(bundleRoot, appRoot),
      (error) => {
        assert.match(error.message, /Bundled Skill validation failed/);
        assert.match(error.message, /\[requirements\]/);
        return true;
      },
    );
    assert.equal(existsSync(join(appRoot, "bundled-resources")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Skill validation rejects duplicate names inside one scene", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-skills-duplicate-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const skillRoot = join(bundleRoot, "scenes", "design", "skills");
    writeSkill(skillRoot, "first", "shared-design-skill");
    writeSkill(skillRoot, "second", "shared-design-skill");

    await assert.rejects(
      () => validateBundledSkills(bundleRoot),
      (error) => {
        assert.match(error.message, /Bundled Skill validation failed/);
        assert.match(error.message, /\[design\]/);
        assert.match(error.message, /collision|duplicate|same name/i);
        return true;
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Skill validation rejects links in supporting resource directories", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-skills-linked-resource-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    const externalRoot = join(tempRoot, "external-assets");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    mkdirSync(externalRoot, { recursive: true });
    writeFileSync(join(externalRoot, "company-secret.txt"), "must not be packaged\n", "utf8");
    const skillRoot = join(bundleRoot, "scenes", "development", "skills");
    writeSkill(skillRoot, "linked-resource", "linked-resource");
    try {
      symlinkSync(
        externalRoot,
        join(skillRoot, "linked-resource", "references"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("creating filesystem links is not permitted on this host");
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => validateBundledSkills(bundleRoot),
      (error) => {
        assert.match(error.message, /Bundled Skill validation failed/);
        assert.match(error.message, /\[development\]/);
        assert.match(error.message, /link|outside/i);
        return true;
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Skill validation rejects a declared Skill root that is a filesystem link", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wireless-ate-skills-linked-root-"));
  try {
    const bundleRoot = join(tempRoot, "bundle");
    cpSync(sourceRoot, bundleRoot, { recursive: true });
    const skillRoot = join(bundleRoot, "scenes", "development", "skills");
    const linkedTarget = join(bundleRoot, "scenes", "development", "linked-skill-target");
    rmSync(skillRoot, { recursive: true, force: true });
    writeSkill(linkedTarget, "company-development", "company-development");
    try {
      symlinkSync(linkedTarget, skillRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("creating filesystem links is not permitted on this host");
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => validateBundledSkills(bundleRoot),
      (error) => {
        assert.match(error.message, /Bundled Skill validation failed/);
        assert.match(error.message, /\[development\]/);
        assert.match(error.message, /link/i);
        return true;
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
