import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function makeZip() {
  const zip = new JSZip();
  zip.file(
    "portable/SKILL.md",
    "---\nname: portable\ndescription: Portable instructions\n---\n",
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeInvalidFrontmatterZip() {
  const zip = new JSZip();
  zip.file(
    "private/SKILL.md",
    "---\nname: [file-content-secret\ndescription: Private\n---\n",
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("skill ZIP inspection returns a digest and sanitized summary without installing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-inspect-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(root, "agent-must-not-be-created");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const { POST } = await jiti.import("./route.ts");
    const archive = await makeZip();
    const form = new FormData();
    form.set("file", new File([archive], "portable.zip", { type: "application/zip" }));
    const request = new Request("http://127.0.0.1/api/skills/upload/inspect", {
      method: "POST",
      headers: { host: "127.0.0.1" },
      body: form,
    });

    const response = await POST(request);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(
      body.inspection.sha256,
      createHash("sha256").update(archive).digest("hex"),
    );
    assert.deepEqual(body.inspection.skill, {
      name: "portable",
      description: "Portable instructions",
      fileCount: 1,
    });
    assert.equal(body.inspection.risk, "instructions-only");
    await assert.rejects(() => access(agentDir), /ENOENT/);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("skill ZIP inspection rejects non-multipart requests", async () => {
  const { POST } = await jiti.import("./route.ts");
  const request = new Request("http://127.0.0.1/api/skills/upload/inspect", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: "{}",
  });

  const response = await POST(request);

  assert.equal(response.status, 415);
});

test("skill ZIP inspection errors never echo uploaded file content", async () => {
  const { POST } = await jiti.import("./route.ts");
  const form = new FormData();
  form.set(
    "file",
    new File([await makeInvalidFrontmatterZip()], "private.zip", { type: "application/zip" }),
  );
  const response = await POST(new Request("http://127.0.0.1/api/skills/upload/inspect", {
    method: "POST",
    headers: { host: "127.0.0.1" },
    body: form,
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid skill ZIP");
  assert.doesNotMatch(JSON.stringify(body), /file-content-secret|description: Private/);
});
