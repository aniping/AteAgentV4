import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseSkillArchive } = await jiti.import("./skill-archive.ts");

async function loadInstaller() {
  return jiti.import("./skill-archive-install.ts");
}

async function parseZip(files) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return parseSkillArchive(await zip.generateAsync({ type: "nodebuffer" }));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function parseIntegrationZip({
  id = "debug-runtime",
  skillName = "integrated",
  serverName = "debug-server",
  requiredTools,
} = {}) {
  const files = {
    [`skill/${skillName}/SKILL.md`]: `---\nname: ${skillName}\ndescription: Integrated\n---\n`,
    "runtime/server.exe": Buffer.from("binary"),
  };
  files["ateagent-integration.json"] = JSON.stringify({
    schemaVersion: 1,
    id,
    version: "0.1.0",
    platform: process.platform,
    arch: process.arch,
    skill: { name: skillName, path: `skill/${skillName}` },
    mcp: {
      serverName,
      executable: "runtime/server.exe",
      ...(requiredTools ? { requiredTools } : {}),
    },
  });
  files["SHA256SUMS.json"] = JSON.stringify({
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, sha256(value)])),
  });
  return parseZip(files);
}

test("installs and uninstalls a plain archive in the selected Pi skill scope", async () => {
  const { installSkillArchive, uninstallSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-install-"));
  try {
    const agentDir = join(root, "agent");
    const parsed = await parseZip({
      "portable/SKILL.md": "---\nname: portable\ndescription: Portable\n---\n",
      "portable/scripts/run.js": "console.log('ok');\n",
    });

    const result = await installSkillArchive(parsed, {
      scope: "global",
      cwd: join(root, "project"),
      agentDir,
    });

    assert.equal(result.skillName, "portable");
    assert.equal(
      await readFile(join(agentDir, "skills", "portable", "scripts", "run.js"), "utf8"),
      "console.log('ok');\n",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(agentDir, "skill-archives", "portable.json"), "utf8")),
      {
        schemaVersion: 1,
        kind: "skill",
        skillName: "portable",
      },
    );
    await uninstallSkillArchive("portable", { scope: "global", cwd: root, agentDir });
    await assert.rejects(() => readFile(join(agentDir, "skills", "portable", "SKILL.md")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs a generic integration and merges its MCP server configuration", async () => {
  const { installSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-integration-install-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }),
      "utf8",
    );
    let adapterCalls = 0;

    const result = await installSkillArchive(await parseIntegrationZip(), {
      scope: "project",
      cwd,
      agentDir,
      async ensureMcpSupport() {
        adapterCalls += 1;
        return true;
      },
    });

    const config = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
    assert.equal(adapterCalls, 1);
    assert.equal(result.mcpAdapterInstalled, true);
    assert.equal(config.mcpServers.existing.command, "existing");
    assert.equal(Object.hasOwn(config.mcpServers["debug-server"], "directTools"), false);
    assert.equal(
      config.mcpServers["debug-server"].command,
      join(cwd, ".pi", "integrations", "debug-runtime", "runtime", "server.exe"),
    );
    assert.equal(
      await readFile(join(cwd, ".pi", "skills", "integrated", "SKILL.md"), "utf8"),
      "---\nname: integrated\ndescription: Integrated\n---\n",
    );
    assert.equal(
      await readFile(join(cwd, ".pi", "integrations", "debug-runtime", "runtime", "server.exe"), "utf8"),
      "binary",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maps legacy requiredTools to the adapter direct-tool allowlist", async () => {
  const { installSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-integration-legacy-tools-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await installSkillArchive(await parseIntegrationZip({ requiredTools: ["debug_start"] }), {
      scope: "project",
      cwd,
      agentDir,
      ensureMcpSupport: async () => false,
    });

    const config = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
    assert.deepEqual(config.mcpServers["debug-server"].directTools, ["debug_start"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to overwrite an existing skill target", async () => {
  const { installSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-conflict-"));
  try {
    const agentDir = join(root, "agent");
    const skillDir = join(agentDir, "skills", "portable");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "existing", "utf8");
    const parsed = await parseZip({
      "portable/SKILL.md": "---\nname: portable\ndescription: Portable\n---\n",
    });

    await assert.rejects(
      () => installSkillArchive(parsed, { scope: "global", cwd: root, agentDir }),
      /Skill target already exists/,
    );
    assert.equal(await readFile(join(skillDir, "SKILL.md"), "utf8"), "existing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent MCP config merges without losing either server", async () => {
  const { installSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-concurrent-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const [first, second] = await Promise.all([
      parseIntegrationZip({ id: "first-runtime", skillName: "first-skill", serverName: "first-server" }),
      parseIntegrationZip({ id: "second-runtime", skillName: "second-skill", serverName: "second-server" }),
    ]);
    await Promise.all([
      installSkillArchive(first, { scope: "project", cwd, agentDir, ensureMcpSupport: async () => false }),
      installSkillArchive(second, { scope: "project", cwd, agentDir, ensureMcpSupport: async () => false }),
    ]);

    const config = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
    assert.equal(Object.hasOwn(config.mcpServers["first-server"], "directTools"), false);
    assert.equal(Object.hasOwn(config.mcpServers["second-server"], "directTools"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers and completely uninstalls an integration archive", async () => {
  const { installSkillArchive, listSkillArchiveInstallations, uninstallSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-integration-uninstall-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }),
      "utf8",
    );
    await installSkillArchive(await parseIntegrationZip(), {
      scope: "project",
      cwd,
      agentDir,
      ensureMcpSupport: async () => false,
    });
    await rm(join(cwd, ".pi", "skill-archives", "integrated.json"));

    assert.deepEqual(await listSkillArchiveInstallations({ cwd, agentDir }), [{
      kind: "integration",
      scope: "project",
      skillName: "integrated",
      integrationId: "debug-runtime",
      mcpServer: "debug-server",
    }]);

    const result = await uninstallSkillArchive("integrated", {
      scope: "project",
      cwd,
      agentDir,
    });

    assert.equal(result.skillName, "integrated");
    await assert.rejects(() => readFile(join(cwd, ".pi", "skills", "integrated", "SKILL.md")), /ENOENT/);
    await assert.rejects(() => readFile(join(cwd, ".pi", "integrations", "debug-runtime", "runtime", "server.exe")), /ENOENT/);
    await assert.rejects(() => readFile(join(cwd, ".pi", "skill-archives", "integrated.json")), /ENOENT/);
    const config = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
    assert.deepEqual(config.mcpServers, { existing: { command: "existing" } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to remove an MCP entry that no longer belongs to the integration", async () => {
  const { installSkillArchive, uninstallSkillArchive } = await loadInstaller();
  const root = await mkdtemp(join(tmpdir(), "pi-web-integration-ownership-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await installSkillArchive(await parseIntegrationZip(), {
      scope: "project",
      cwd,
      agentDir,
      ensureMcpSupport: async () => false,
    });
    await writeFile(
      join(cwd, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { "debug-server": { command: "someone-else" } } }),
      "utf8",
    );

    await assert.rejects(
      () => uninstallSkillArchive("integrated", { scope: "project", cwd, agentDir }),
      /no longer points to this integration/,
    );
    assert.equal(
      await readFile(join(cwd, ".pi", "skills", "integrated", "SKILL.md"), "utf8"),
      "---\nname: integrated\ndescription: Integrated\n---\n",
    );
    assert.equal(
      await readFile(join(cwd, ".pi", "integrations", "debug-runtime", "runtime", "server.exe"), "utf8"),
      "binary",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
