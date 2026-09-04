import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  DefaultResourceLoader,
  ExtensionRunner,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("内置 Subagents 扩展来自固定的应用生产依赖", async () => {
  const { getBundledSubagentsResources } = await jiti.import("./bundled-subagents.ts");

  const resources = getBundledSubagentsResources();

  assert.equal(resources.extensionPaths.length, 1);
  assert.match(
    resources.extensionPaths[0].replaceAll("\\", "/"),
    /node_modules\/@tintinweb\/pi-subagents\/src\/index\.ts$/,
  );
  await access(resources.extensionPaths[0]);
});

test("内置 Subagents 生成可展示的已加载插件信息", async () => {
  const { getBundledSubagentsPluginInfo, getBundledSubagentsResources } = await jiti.import(
    "./bundled-subagents.ts"
  );
  const extensionPath = getBundledSubagentsResources().extensionPaths[0];

  assert.deepEqual(getBundledSubagentsPluginInfo(), {
    source: "@tintinweb/pi-subagents",
    scope: "global",
    builtin: true,
    filtered: false,
    disabled: false,
    installedPath: dirname(dirname(extensionPath)),
    packageName: "@tintinweb/pi-subagents",
    version: "0.19.0",
    counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    resources: [{
      kind: "extension",
      name: "pi-subagents",
      path: extensionPath,
      relativePath: "src/index.ts",
    }],
    status: "loaded",
  });
});

test("只识别 Subagents 的 npm 包来源", async () => {
  const { isSubagentsSource } = await jiti.import("./bundled-subagents.ts");

  assert.equal(isSubagentsSource("npm:@tintinweb/pi-subagents"), true);
  assert.equal(isSubagentsSource("npm:@tintinweb/pi-subagents@0.19.0"), true);
  assert.equal(isSubagentsSource("npm:@tintinweb/pi-subagents-next"), false);
  assert.equal(isSubagentsSource("npm:pi-subagents"), false);
});

test("升级时只迁移用户全局安装的 Subagents 包", async () => {
  const { migrateUserSubagentsPackages } = await jiti.import("./bundled-subagents.ts");
  const removed = [];
  const packageManager = {
    listConfiguredPackages() {
      return [
        { source: "npm:@tintinweb/pi-subagents", scope: "user", filtered: false },
        { source: "npm:@tintinweb/pi-subagents@0.18.0", scope: "user", filtered: false },
        { source: "npm:@tintinweb/pi-subagents", scope: "project", filtered: false },
        { source: "npm:another-extension", scope: "user", filtered: false },
      ];
    },
    async removeAndPersist(source, options) {
      removed.push({ source, options });
      return true;
    },
  };

  const migrated = await migrateUserSubagentsPackages(packageManager);

  assert.deepEqual(migrated, [
    "npm:@tintinweb/pi-subagents",
    "npm:@tintinweb/pi-subagents@0.18.0",
  ]);
  assert.deepEqual(removed, [
    { source: "npm:@tintinweb/pi-subagents", options: { local: false } },
    { source: "npm:@tintinweb/pi-subagents@0.18.0", options: { local: false } },
  ]);
});

test("迁移用户包后为 Pi 会话启用内置 Subagents 入口", async () => {
  const { prepareBundledSubagents } = await jiti.import("./bundled-subagents.ts");
  const removed = [];
  const packageManager = {
    listConfiguredPackages() {
      return [{ source: "npm:@tintinweb/pi-subagents", scope: "user", filtered: false }];
    },
    async removeAndPersist(source) {
      removed.push(source);
      return true;
    },
  };

  const resources = await prepareBundledSubagents(packageManager);

  assert.equal(resources.extensionPaths.length, 1);
  assert.match(
    resources.extensionPaths[0].replaceAll("\\", "/"),
    /node_modules\/@tintinweb\/pi-subagents\/src\/index\.ts$/,
  );
  assert.deepEqual(removed, ["npm:@tintinweb/pi-subagents"]);
});

test("项目 Subagents 配置不会在成功加载前屏蔽内置入口", async () => {
  const { prepareBundledSubagents } = await jiti.import("./bundled-subagents.ts");
  const removed = [];
  const packageManager = {
    listConfiguredPackages() {
      return [
        { source: "npm:@tintinweb/pi-subagents", scope: "project", filtered: false },
        { source: "npm:@tintinweb/pi-subagents@0.18.0", scope: "user", filtered: false },
      ];
    },
    async removeAndPersist(source) {
      removed.push(source);
      return true;
    },
  };

  const resources = await prepareBundledSubagents(packageManager);

  assert.equal(resources.extensionPaths.length, 1);
  assert.deepEqual(removed, ["npm:@tintinweb/pi-subagents@0.18.0"]);
});

test("只读预设不激活可写的 Subagents 工具", async () => {
  const { filterSubagentToolsForPreset, SUBAGENT_TOOL_NAMES } = await jiti.import(
    "./bundled-subagents.ts"
  );
  const extensionTools = [...SUBAGENT_TOOL_NAMES, "mcp"];

  assert.deepEqual(
    filterSubagentToolsForPreset(extensionTools, ["read", "grep", "find", "ls"]),
    ["mcp"],
  );
  assert.deepEqual(
    filterSubagentToolsForPreset(extensionTools, ["read", "bash", "edit", "write"]),
    extensionTools,
  );
  assert.deepEqual(
    filterSubagentToolsForPreset(extensionTools, ["read", "Agent"]),
    extensionTools,
  );
});

test("成功加载的项目 Subagents 替换内置副本并清理成对冲突", async () => {
  const { getBundledSubagentsResources, preferLoadedProjectSubagents } = await jiti.import(
    "./bundled-subagents.ts"
  );
  const bundledPath = getBundledSubagentsResources().extensionPaths[0];
  const projectPath = join(
    tmpdir(),
    "project",
    ".pi",
    "npm",
    "node_modules",
    "@tintinweb",
    "pi-subagents",
    "src",
    "index.ts",
  );
  const bundled = { path: bundledPath, resolvedPath: bundledPath };
  const project = { path: projectPath, resolvedPath: projectPath };
  const runtime = {};
  const result = preferLoadedProjectSubagents({
    extensions: [bundled, project],
    errors: [
      { path: projectPath, error: `Tool "Agent" conflicts with ${bundledPath}` },
      { path: "another-extension", error: "unrelated diagnostic" },
    ],
    runtime,
  });

  assert.deepEqual(result.extensions, [project]);
  assert.deepEqual(result.errors, [
    { path: "another-extension", error: "unrelated diagnostic" },
  ]);
  assert.equal(result.runtime, runtime);
});

test("项目 Subagents 缺失或加载失败时保留内置副本", async () => {
  const { getBundledSubagentsResources, preferLoadedProjectSubagents } = await jiti.import(
    "./bundled-subagents.ts"
  );
  const bundledPath = getBundledSubagentsResources().extensionPaths[0];
  const base = {
    extensions: [{ path: bundledPath, resolvedPath: bundledPath }],
    errors: [{ path: "missing-project-copy", error: "failed to load" }],
    runtime: {},
  };

  assert.equal(preferLoadedProjectSubagents(base), base);
});

test("Pi ResourceLoader 从内置入口注册完整 Subagents 工具面", async () => {
  const root = await mkdtemp(join(tmpdir(), "ate-bundled-subagents-"));
  const agentDir = join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let runner;

  try {
    const { getBundledSubagentsResources } = await jiti.import("./bundled-subagents.ts");
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager: SettingsManager.inMemory({}),
      additionalExtensionPaths: getBundledSubagentsResources().extensionPaths,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });

    await loader.reload();
    const loaded = loader.getExtensions();
    runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      root,
      SessionManager.inMemory(root),
      {},
    );
    const runnerErrors = [];
    runner.onError((error) => runnerErrors.push(error));

    assert.deepEqual(loaded.errors, []);
    const toolNames = new Set(
      loaded.extensions.flatMap((extension) => [...extension.tools.keys()]),
    );
    assert.deepEqual(
      [...toolNames].sort(),
      ["Agent", "SubagentWorkflow", "get_subagent_result", "steer_subagent"].sort(),
    );
    assert.deepEqual(runnerErrors, []);
  } finally {
    if (runner) {
      await runner.emit({ type: "session_shutdown", reason: "quit" });
      runner.invalidate();
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
