import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
