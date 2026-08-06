import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");

test("plugin inventory includes the bundled MCP adapter", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ate-plugin-inventory-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  allowFileRoot(cwd);

  const response = await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`));
  assert.equal(response.status, 200);
  const inventory = await response.json();
  const adapter = inventory.packages.find((pkg) => pkg.packageName === "pi-mcp-adapter");

  assert.ok(adapter);
  assert.equal(adapter.builtin, true);
  assert.equal(adapter.status, "loaded");
  assert.deepEqual(adapter.counts, { extensions: 1, skills: 1, prompts: 0, themes: 0 });
  assert.equal(inventory.totals.extensions, 1);
  assert.equal(inventory.totals.skills, 1);
});

test("plugin inventory migrates an existing user MCP package without duplicate counts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ate-plugin-upgrade-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-mcp-adapter"] }));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  allowFileRoot(cwd);

  const response = await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`));
  const inventory = await response.json();
  const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));

  assert.equal(response.status, 200);
  assert.equal(inventory.packages.length, 1);
  assert.equal(inventory.packages.filter((pkg) => pkg.packageName === "pi-mcp-adapter").length, 1);
  assert.ok(!inventory.packages.some((pkg) => pkg.source.startsWith("npm:pi-mcp-adapter")));
  assert.equal(inventory.totals.extensions, 1);
  assert.equal(inventory.totals.skills, 1);
  assert.deepEqual(settings.packages, []);
});
