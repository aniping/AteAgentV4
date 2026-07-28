import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadArchiveModule() {
  return jiti.import("./skill-archive.ts");
}

async function makeZip(files) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.generateAsync({ type: "nodebuffer" });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function makeIntegrationZip({ tamperRuntime = false } = {}) {
  const files = {
    "skill/portable-skill/SKILL.md": [
      "---",
      "name: portable-skill",
      "description: A portable integration skill",
      "---",
      "",
    ].join("\n"),
    "runtime/server.exe": Buffer.from(tamperRuntime ? "changed" : "binary"),
  };
  files["ateagent-integration.json"] = JSON.stringify({
    schemaVersion: 1,
    id: "portable-integration",
    version: "1.2.3",
    platform: process.platform,
    arch: process.arch,
    skill: { name: "portable-skill", path: "skill/portable-skill" },
    mcp: {
      serverName: "portable-server",
      executable: "runtime/server.exe",
      args: ["--stdio"],
      requiredTools: ["portable_debug"],
    },
  });
  const checksums = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, sha256(value)]),
  );
  if (tamperRuntime) checksums["runtime/server.exe"] = sha256("binary");
  files["SHA256SUMS.json"] = JSON.stringify({ schemaVersion: 1, files: checksums });
  return makeZip(files);
}

test("parses a wrapped portable skill archive", async () => {
  const { parseSkillArchive } = await loadArchiveModule();
  const archive = await makeZip({
    "portable-skill/SKILL.md": [
      "---",
      "name: portable-skill",
      "description: A portable test skill",
      "---",
      "",
      "Use the bundled script.",
    ].join("\n"),
    "portable-skill/scripts/run.js": "console.log('ok');\n",
  });

  const parsed = await parseSkillArchive(archive);

  assert.equal(parsed.kind, "skill");
  assert.equal(parsed.skill.name, "portable-skill");
  assert.equal(parsed.skill.description, "A portable test skill");
  assert.deepEqual(
    parsed.skill.files.map((file) => file.path),
    ["SKILL.md", "scripts/run.js"],
  );
});

test("parses a generic checksummed integration archive", async () => {
  const { parseSkillArchive } = await loadArchiveModule();
  const parsed = await parseSkillArchive(await makeIntegrationZip());

  assert.equal(parsed.kind, "integration");
  assert.equal(parsed.id, "portable-integration");
  assert.equal(parsed.skill.name, "portable-skill");
  assert.deepEqual(parsed.mcp, {
    serverName: "portable-server",
    executable: "runtime/server.exe",
    requiredTools: ["portable_debug"],
    args: ["--stdio"],
    env: undefined,
  });
});

test("rejects path traversal and symbolic links", async () => {
  const { parseSkillArchive, SkillArchiveError } = await loadArchiveModule();
  const traversal = await makeZip({
    "../escape.txt": "nope",
    "safe/SKILL.md": "---\nname: safe\ndescription: Safe\n---\n",
  });
  await assert.rejects(() => parseSkillArchive(traversal), SkillArchiveError);

  const zip = new JSZip();
  zip.file("linked-skill/SKILL.md", "target", { unixPermissions: 0o120777 });
  const symlink = await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
  await assert.rejects(() => parseSkillArchive(symlink), /Symbolic links are not allowed/);
});

test("rejects a ZIP entry whose CRC32 is corrupted", async () => {
  const { parseSkillArchive } = await loadArchiveModule();
  const zip = new JSZip();
  const skill = "---\nname: crc-skill\ndescription: Original marker\n---\n";
  zip.file("crc-skill/SKILL.md", skill);
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  const marker = Buffer.from("Original marker");
  const markerOffset = archive.indexOf(marker);
  assert.notEqual(markerOffset, -1);
  archive[markerOffset] ^= 1;

  await assert.rejects(() => parseSkillArchive(archive), /CRC32 mismatch/);
});

test("rejects ambiguous skills and files outside a plain skill root", async () => {
  const { parseSkillArchive } = await loadArchiveModule();
  const twoSkills = await makeZip({
    "one/SKILL.md": "---\nname: one\ndescription: One\n---\n",
    "two/SKILL.md": "---\nname: two\ndescription: Two\n---\n",
  });
  await assert.rejects(() => parseSkillArchive(twoSkills), /exactly one SKILL\.md/);

  const unrelatedFile = await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable\n---\n",
    "README.md": "outside",
  });
  await assert.rejects(() => parseSkillArchive(unrelatedFile), /outside the skill directory/);
});

test("rejects integration files whose SHA-256 does not match", async () => {
  const { parseSkillArchive } = await loadArchiveModule();
  const archive = await makeIntegrationZip({ tamperRuntime: true });
  await assert.rejects(
    () => parseSkillArchive(archive),
    /SHA-256 mismatch for runtime\/server\.exe/,
  );
});
