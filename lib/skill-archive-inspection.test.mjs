import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./skill-archive-inspection.ts");
}

async function makeZip(files) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.generateAsync({ type: "nodebuffer" });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function makeIntegrationZip() {
  const files = {
    "skill/portable/SKILL.md": "---\nname: portable\ndescription: Portable integration\n---\n",
    "runtime/server.exe": Buffer.from("runtime-bytes"),
  };
  files["ateagent-integration.json"] = JSON.stringify({
    schemaVersion: 1,
    id: "portable-runtime",
    version: "1.2.3",
    platform: process.platform,
    arch: process.arch,
    skill: { name: "portable", path: "skill/portable" },
    mcp: {
      serverName: "portable-server",
      executable: "runtime/server.exe",
      requiredTools: ["portable_run"],
      args: ["--token", "argument-secret"],
      env: { API_TOKEN: "environment-secret" },
    },
  });
  files["SHA256SUMS.json"] = JSON.stringify({
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, sha256(value)])),
  });
  return makeZip(files);
}

test("inspection classifies instruction-only and supporting-file skill ZIPs", async () => {
  const { inspectSkillArchive } = await loadSubject();
  const instructionsOnly = await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable instructions\n---\n",
  });
  const supportingFiles = await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable instructions\n---\n",
    "portable/scripts/run.js": "console.log('ok');\n",
  });

  const first = await inspectSkillArchive(instructionsOnly);
  const second = await inspectSkillArchive(supportingFiles);

  assert.equal(first.inspection.sha256, sha256(instructionsOnly));
  assert.equal(first.inspection.risk, "instructions-only");
  assert.deepEqual(first.inspection.skill, {
    name: "portable",
    description: "Portable instructions",
    fileCount: 1,
  });
  assert.deepEqual(first.inspection.archive, {
    fileCount: 1,
    expandedBytes: Buffer.byteLength("---\nname: portable\ndescription: Portable instructions\n---\n"),
  });
  assert.equal(second.inspection.risk, "supporting-files");
  assert.equal(second.inspection.skill.fileCount, 2);
  assert.equal(second.inspection.archive.fileCount, 2);
});

test("integration inspection exposes only a redacted runtime summary", async () => {
  const { inspectSkillArchive } = await loadSubject();
  const inspected = await inspectSkillArchive(await makeIntegrationZip());

  assert.equal(inspected.inspection.kind, "integration");
  assert.equal(inspected.inspection.risk, "integration-runtime");
  assert.deepEqual(inspected.inspection.integration, {
    id: "portable-runtime",
    version: "1.2.3",
    mcp: {
      serverName: "portable-server",
      executable: "runtime/server.exe",
      requiredTools: ["portable_run"],
      environmentNames: ["API_TOKEN"],
    },
  });
  assert.equal(inspected.inspection.skill.fileCount, 1);
  assert.equal(inspected.inspection.archive.fileCount, 4);

  const serialized = JSON.stringify(inspected.inspection);
  assert.doesNotMatch(serialized, /environment-secret|argument-secret|runtime-bytes/);
  assert.equal("files" in inspected.inspection, false);
  assert.equal("env" in inspected.inspection.integration.mcp, false);
  assert.equal("args" in inspected.inspection.integration.mcp, false);
});

test("install confirmation binds approval to the inspected ZIP bytes", async () => {
  const {
    assertSkillArchiveInstallConfirmation,
    inspectSkillArchive,
  } = await loadSubject();
  const instructionsOnly = await inspectSkillArchive(await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable instructions\n---\n",
  }));
  const supportingFiles = await inspectSkillArchive(await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable instructions\n---\n",
    "portable/run.js": "console.log('ok');\n",
  }));

  assert.doesNotThrow(() => assertSkillArchiveInstallConfirmation(
    instructionsOnly.inspection,
    instructionsOnly.inspection.sha256,
    false,
  ));
  assert.throws(
    () => assertSkillArchiveInstallConfirmation(instructionsOnly.inspection, "0".repeat(64), true),
    /changed after inspection/i,
  );
  assert.throws(
    () => assertSkillArchiveInstallConfirmation(supportingFiles.inspection, supportingFiles.inspection.sha256, false),
    /riskAcknowledged=true/,
  );
  assert.doesNotThrow(() => assertSkillArchiveInstallConfirmation(
    supportingFiles.inspection,
    supportingFiles.inspection.sha256,
    true,
  ));
});
