import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

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
    "skill/integrated/SKILL.md": "---\nname: integrated\ndescription: Integrated skill\n---\n",
    "runtime/server.exe": Buffer.from("runtime"),
  };
  files["ateagent-integration.json"] = JSON.stringify({
    schemaVersion: 1,
    id: "integrated-runtime",
    version: "1.0.0",
    platform: process.platform,
    arch: process.arch,
    skill: { name: "integrated", path: "skill/integrated" },
  });
  files["SHA256SUMS.json"] = JSON.stringify({
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, sha256(value)])),
  });
  return makeZip(files);
}

function uploadRequest(archive, fields = {}) {
  const form = new FormData();
  form.set("file", new File([archive], "portable.zip", { type: "application/zip" }));
  form.set("scope", fields.scope ?? "global");
  form.set("cwd", fields.cwd ?? process.cwd());
  if (fields.expectedSha256 !== undefined) form.set("expectedSha256", fields.expectedSha256);
  if (fields.riskAcknowledged !== undefined) {
    form.set("riskAcknowledged", String(fields.riskAcknowledged));
  }
  return new Request("http://127.0.0.1/api/skills/upload", {
    method: "POST",
    headers: { host: "127.0.0.1" },
    body: form,
  });
}

test("skill ZIP upload rejects a malformed archive without writing it", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { POST } = await jiti.import("./route.ts");
  const form = new FormData();
  form.set("file", new File(["not a zip"], "broken.zip", { type: "application/zip" }));
  form.set("scope", "global");
  form.set("cwd", process.cwd());
  const request = new Request("http://127.0.0.1/api/skills/upload", {
    method: "POST",
    headers: { host: "127.0.0.1" },
    body: form,
  });

  const response = await POST(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Skill ZIP is invalid or could not be installed");
});

test("skill ZIP install requires the digest returned by inspection", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { POST } = await jiti.import("./route.ts");
  const archive = await makeZip({
    "portable/SKILL.md": "---\nname: portable\ndescription: Portable\n---\n",
  });

  const missing = await POST(uploadRequest(archive));
  const missingBody = await missing.json();
  assert.equal(missing.status, 400);
  assert.match(missingBody.error, /expectedSha256/);

  const response = await POST(uploadRequest(archive, { expectedSha256: "0".repeat(64) }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /changed after inspection/i);
});

test("skill ZIP install requires explicit acknowledgement for both risky archive kinds", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { POST } = await jiti.import("./route.ts");
  const archives = [
    await makeZip({
      "portable/SKILL.md": "---\nname: portable\ndescription: Portable\n---\n",
      "portable/scripts/run.js": "console.log('ok');\n",
    }),
    await makeIntegrationZip(),
  ];

  for (const archive of archives) {
    const response = await POST(uploadRequest(archive, { expectedSha256: sha256(archive) }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /riskAcknowledged=true/);
  }
});

test("instruction-only ZIP installs with a matching digest and no risk acknowledgement", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-upload-confirmed-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  try {
    const { allowFileRoot } = await jiti.import("@/lib/file-access");
    allowFileRoot(root);
    const { POST } = await jiti.import("./route.ts");
    const archive = await makeZip({
      "confirmed/SKILL.md": "---\nname: confirmed\ndescription: Confirmed\n---\n",
    });

    const response = await POST(uploadRequest(archive, {
      cwd: root,
      expectedSha256: sha256(archive),
    }));

    assert.equal(response.status, 200);
    assert.match(
      await readFile(join(root, "agent", "skills", "confirmed", "SKILL.md"), "utf8"),
      /name: confirmed/,
    );
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP 集成使用内置 Adapter 而不再在线安装", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const ensureMcpSource = source.slice(
    source.indexOf("async ensureMcpSupport()"),
    source.indexOf("    });", source.indexOf("async ensureMcpSupport()")),
  );

  assert.match(ensureMcpSource, /getBundledMcpAdapterResources\(\)/);
  assert.doesNotMatch(ensureMcpSource, /installAndPersist|MCP_ADAPTER_SOURCE/);
});

test("a successful project upload records the explicit project trust decision", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(scope === "project"\) trustProject\(cwd, agentDir\)/);
});

test("skill archive uninstall rejects an unsafe skill name", async () => {
  const { allowFileRoot } = await jiti.import("@/lib/file-access");
  allowFileRoot(process.cwd());
  const { DELETE } = await jiti.import("./route.ts");
  const request = new Request("http://127.0.0.1/api/skills/upload", {
    method: "DELETE",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({ cwd: process.cwd(), scope: "global", skillName: "../escape" }),
  });

  const response = await DELETE(request);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Invalid skill name/);
});
