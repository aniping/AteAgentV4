import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("场景 MCP 叠加保留 ambient 配置并以场景内置服务器为准", async () => {
  const { mergeSceneMcpServers } = await jiti.import("./mcp-adapter.ts");
  const ambient = {
    imports: ["codex"],
    settings: { scriptMode: false, directTools: true, disableProxyTool: true },
    mcpServers: {
      existing: { command: "existing-server" },
      microbreakpoint: {
        command: "user-shadow",
        url: "https://example.invalid/mcp",
        env: { BREAKHUB_SHADOW: "1" },
        disabled: true,
        directTools: true,
      },
    },
  };

  const merged = mergeSceneMcpServers(ambient, [
    {
      id: "breakhub",
      version: "0.1.0",
      serverName: "microbreakpoint",
      command: "C:\\ATEAgent\\breakhub-mcp.exe",
      args: [],
      lifecycle: "lazy",
    },
  ]);

  assert.deepEqual(merged, {
    imports: ["codex"],
    settings: { scriptMode: false, directTools: true, disableProxyTool: false },
    mcpServers: {
      existing: { command: "existing-server" },
      microbreakpoint: {
        command: "C:\\ATEAgent\\breakhub-mcp.exe",
        lifecycle: "lazy",
        directTools: false,
        ignoreDirectToolsEnv: true,
      },
    },
  });
  assert.equal(ambient.mcpServers.microbreakpoint.command, "user-shadow");
});

test("BreakHub 忽略 direct-tools 环境选择但保留 ambient 服务器选择", async () => {
  const [{ resolveDirectTools }, { computeServerHash, getMissingConfiguredDirectToolServers }] = await Promise.all([
    jiti.import("../node_modules/pi-mcp-adapter/direct-tools.ts"),
    jiti.import("../node_modules/pi-mcp-adapter/metadata-cache.ts"),
  ]);
  const ambientDefinition = { command: "ambient-mcp", directTools: false };
  const breakhubDefinition = {
    command: "breakhub-mcp.exe",
    directTools: false,
    ignoreDirectToolsEnv: true,
  };
  const config = {
    mcpServers: {
      ambient: ambientDefinition,
      microbreakpoint: breakhubDefinition,
    },
  };
  const cache = {
    version: 1,
    servers: {
      ambient: {
        configHash: computeServerHash(ambientDefinition),
        tools: [{ name: "inspect" }],
        resources: [],
        cachedAt: Date.now(),
      },
      microbreakpoint: {
        configHash: computeServerHash(breakhubDefinition),
        tools: [{ name: "list_equipment" }],
        resources: [],
        cachedAt: Date.now(),
      },
    },
  };
  const selectors = ["ambient/inspect", "microbreakpoint/list_equipment"];

  assert.deepEqual(
    resolveDirectTools(config, cache, "server", selectors).map((tool) => [tool.serverName, tool.originalName]),
    [["ambient", "inspect"]],
  );
  assert.deepEqual(getMissingConfiguredDirectToolServers(config, null, selectors), ["ambient"]);
  assert.deepEqual(resolveDirectTools(config, cache, "server", ["microbreakpoint"]), []);
  assert.deepEqual(getMissingConfiguredDirectToolServers(config, null, ["microbreakpoint"]), []);
  assert.deepEqual(resolveDirectTools(config, cache, "server"), []);
  assert.deepEqual(
    resolveDirectTools(config, cache, "server", ["ambient"]).map((tool) => tool.serverName),
    ["ambient"],
  );
});

test("过滤竞争 Adapter 时会在 eager 初始化前触发 shutdown", async () => {
  const { preferBundledSceneMcpAdapter } = await jiti.import("./mcp-adapter.ts");
  let lifecycleGeneration = 0;
  let eagerStarted = false;
  let shutdownEvent;
  setImmediate(() => {
    if (lifecycleGeneration === 0) eagerStarted = true;
  });

  const extension = (path, { bundled = false } = {}) => ({
    path,
    resolvedPath: path,
    sourceInfo: { path, source: "test", scope: "temporary", origin: "top-level" },
    handlers: new Map(bundled ? [] : [["session_shutdown", [async (event) => {
      lifecycleGeneration += 1;
      shutdownEvent = event;
    }]]]),
    tools: new Map([["mcp", {}]]),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  });
  const competing = extension("C:\\project\\pi-mcp-adapter.ts");
  const bundled = extension("<inline:pi-mcp-adapter>", { bundled: true });
  const result = preferBundledSceneMcpAdapter({
    extensions: [competing, bundled],
    errors: [],
    runtime: {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(eagerStarted, false);
  assert.deepEqual(shutdownEvent, { type: "session_shutdown", reason: "reload" });
  assert.deepEqual(result.extensions.map((item) => item.path), ["<inline:pi-mcp-adapter>"]);
});

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

test("场景 MCP 的运行时加载器会进入生产依赖和 standalone tracing", async () => {
  const [packageText, nextConfig] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(typeof packageJson.dependencies.jiti, "string");
  assert.equal(packageJson.devDependencies.jiti, undefined);
  assert.match(nextConfig, /collectPackageTraceGlobs\("jiti"\)/);
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

test("场景声明 MCP 时以单个内联 Adapter factory 取代默认扩展入口", async () => {
  const { prepareBundledMcpAdapter } = await jiti.import("./mcp-adapter.ts");
  const packageManager = {
    listConfiguredPackages() {
      return [];
    },
    async removeAndPersist() {
      throw new Error("没有需要迁移的包");
    },
  };

  const resources = await prepareBundledMcpAdapter(packageManager, {
    cwd: process.cwd(),
    sceneMcpServers: [{
      id: "breakhub",
      version: "0.1.0",
      serverName: "microbreakpoint",
      command: "C:\\ATEAgent\\breakhub-mcp.exe",
      args: [],
      lifecycle: "lazy",
    }],
  });

  assert.deepEqual(resources.extensionPaths, []);
  assert.equal(resources.skillPaths.length, 1);
  assert.equal(resources.extensionFactories?.length, 1);
  assert.equal(resources.extensionFactories?.[0]?.name, "pi-mcp-adapter");
  assert.equal(typeof resources.extensionFactories?.[0]?.factory, "function");
});

test("联调场景通过 ResourceLoader 只注册一套 MCP Adapter 工具", async () => {
  const [{ getBundledMcpAdapterResources, preferBundledSceneMcpAdapter, prepareBundledMcpAdapter }, { getSceneResourceConfig }] = await Promise.all([
    jiti.import("./mcp-adapter.ts"),
    jiti.import("./scene-resources.ts"),
  ]);
  const sceneResources = getSceneResourceConfig("integration");
  const resources = await prepareBundledMcpAdapter({
    listConfiguredPackages() {
      return [];
    },
    async removeAndPersist() {
      throw new Error("没有需要迁移的包");
    },
  }, {
    cwd: process.cwd(),
    sceneMcpServers: sceneResources.mcpServers,
    loadAmbientConfig: () => ({ mcpServers: {} }),
  });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(process.cwd(), ".test-agent"),
    settingsManager: SettingsManager.inMemory({
      extensions: [getBundledMcpAdapterResources().extensionPaths[0]],
    }),
    extensionFactories: resources.extensionFactories,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionsOverride: preferBundledSceneMcpAdapter,
  });

  await loader.reload();
  const loaded = loader.getExtensions();
  const countTool = (name) => loaded.extensions.filter((extension) => extension.tools.has(name)).length;

  assert.deepEqual(loaded.errors, []);
  assert.equal(countTool("mcp"), 1);
  assert.equal(countTool("mcpScript"), 1);
  assert.deepEqual(
    loaded.extensions.filter((extension) => extension.tools.has("mcp")).map((extension) => extension.path),
    ["<inline:pi-mcp-adapter>"],
  );
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

test("项目 Adapter 覆盖存在时联调场景仍准备单个内联 Adapter", async () => {
  const { prepareBundledMcpAdapter } = await jiti.import("./mcp-adapter.ts");
  const packageManager = {
    listConfiguredPackages() {
      return [{ source: "npm:pi-mcp-adapter@2.15.0", scope: "project", filtered: false }];
    },
    async removeAndPersist() {
      throw new Error("不应删除项目配置");
    },
  };

  const resources = await prepareBundledMcpAdapter(packageManager, {
    cwd: process.cwd(),
    sceneMcpServers: [{
      id: "breakhub",
      version: "0.1.0",
      serverName: "microbreakpoint",
      command: "C:\\ATEAgent\\breakhub-mcp.exe",
      args: [],
      lifecycle: "lazy",
    }],
  });

  assert.deepEqual(resources.extensionPaths, []);
  assert.deepEqual(resources.skillPaths, []);
  assert.equal(resources.extensionFactories?.length, 1);
  assert.equal(resources.extensionFactories?.[0]?.name, "pi-mcp-adapter");
});
