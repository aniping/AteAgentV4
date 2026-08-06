import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("升级时只卸载用户全局安装的 MCP Adapter", async () => {
  const { migrateUserMcpAdapterPackages } = await jiti.import("./mcp-adapter.ts");
  const removed = [];
  const packageManager = {
    listConfiguredPackages() {
      return [
        { source: "npm:pi-mcp-adapter", scope: "user", filtered: false },
        { source: "npm:pi-mcp-adapter@2.15.0", scope: "user", filtered: false },
        { source: "npm:pi-mcp-adapter", scope: "project", filtered: false },
        { source: "npm:another-extension", scope: "user", filtered: false },
      ];
    },
    async removeAndPersist(source, options) {
      removed.push({ source, options });
      return true;
    },
  };

  const sources = await migrateUserMcpAdapterPackages(packageManager);

  assert.deepEqual(sources, ["npm:pi-mcp-adapter", "npm:pi-mcp-adapter@2.15.0"]);
  assert.deepEqual(removed, [
    { source: "npm:pi-mcp-adapter", options: { local: false } },
    { source: "npm:pi-mcp-adapter@2.15.0", options: { local: false } },
  ]);
});

test("内置 MCP Adapter 的扩展与 Skill 来自应用生产依赖", async () => {
  const { getBundledMcpAdapterResources } = await jiti.import("./mcp-adapter.ts");

  const resources = getBundledMcpAdapterResources();

  assert.match(resources.extensionPaths[0].replaceAll("\\", "/"), /node_modules\/pi-mcp-adapter\/index\.ts$/);
  assert.match(resources.skillPaths[0].replaceAll("\\", "/"), /node_modules\/pi-mcp-adapter\/skills$/);
  await Promise.all([access(resources.extensionPaths[0]), access(resources.skillPaths[0])]);
});

test("内置 MCP Adapter 不通过静态模块解析进入 Next bundle", async () => {
  const source = await readFile(new URL("./mcp-adapter.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /createRequire|\.resolve\(["']pi-mcp-adapter["']\)/);
});

test("迁移用户 Adapter 后为 Pi 会话启用内置入口", async () => {
  const { prepareBundledMcpAdapter } = await jiti.import("./mcp-adapter.ts");
  const removed = [];
  const packageManager = {
    listConfiguredPackages() {
      return [{ source: "npm:pi-mcp-adapter", scope: "user", filtered: false }];
    },
    async removeAndPersist(source) {
      removed.push(source);
      return true;
    },
  };

  const resources = await prepareBundledMcpAdapter(packageManager);

  assert.equal(resources.extensionPaths.length, 1);
  assert.equal(resources.skillPaths.length, 1);
  assert.deepEqual(removed, ["npm:pi-mcp-adapter"]);
});

test("项目显式配置 Adapter 时不重复加载内置入口", async () => {
  const { prepareBundledMcpAdapter } = await jiti.import("./mcp-adapter.ts");
  const packageManager = {
    listConfiguredPackages() {
      return [{ source: "npm:pi-mcp-adapter@2.15.0", scope: "project", filtered: false }];
    },
    async removeAndPersist() {
      throw new Error("不应删除项目配置");
    },
  };

  const resources = await prepareBundledMcpAdapter(packageManager);

  assert.deepEqual(resources, { extensionPaths: [], skillPaths: [] });
});
