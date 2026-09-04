# `@tintinweb/pi-subagents` 内置可行性研究

- 调研日期：2026-09-04
- 调研对象：`@tintinweb/pi-subagents@0.19.0`
- 当前应用基线：AteAgentV4 `18aaecafa82f1abc162341854783e07bc8ac9a83`，Pi `0.84.2`
- 结论置信度：分发与基础加载为高；Web/RPC 完整交互和多会话隔离为中，仍需验收测试

## 1. 结论

**可以把这个包离线随安装包分发，也可以用 Pi 官方的 `additionalExtensionPaths` 机制加载；但不能把未经适配的 `0.19.0` 直接设为所有会话默认启用。**

“内置到安装包”和“在任意会话中自动获得执行权”是两件事。第一件事已经具备技术条件；第二件事会放大第三方扩展的权限、资源消耗和生命周期假设，当前有四项发布阻断：

1. 子会话没有继承 AteAgentV4 的项目可信状态，并会自行发现项目设置、扩展、Agent 和 Skill；在“不信任项目”场景下存在越过宿主信任边界的风险。
2. AteAgentV4 的任意非空工具预设当前都会激活全部扩展工具；因此“只读”父会话也会得到 `Agent`，而插件的通用 Agent 默认拥有 `bash/edit/write`，形成权限升级。
3. 插件的进程级 manager 注册表明确采用“第一次激活获胜”，而 AteAgentV4 在同一 Node 进程中同时托管多个根会话；通过该全局 registry 做跨包直接访问时会指向第一个根会话，不能天然满足多会话隔离。
4. 插件的子会话自行创建 `DefaultResourceLoader`，不会自动得到 AteAgentV4 只注入主会话的内置 MCP factory、场景 Skill 和宿主 Bash 包装器；“内置后子 Agent 自动拥有内置 MCP”目前不成立。

建议路线分两级：**先用精确锁版本 + ATE 受限适配器交付单一前台 Agent 的 opt-in MVP；同时向上游提交 trust/scope/session hooks，完整能力通过门槛后再开放。** 受限 MVP 可以不 fork，但必须主动裁掉项目自定义、后台、Workflow、调度、worktree、跨扩展 RPC 和 TUI 专属界面；若要保留完整插件语义而上游又不接受接口，再维护哈希门控的最小补丁或短期 fork，不建议直接复制整套源码长期分叉。

| 判断项 | 当前判断 | 说明 |
| --- | --- | --- |
| 离线随安装包分发 | **Go** | npm tarball 是纯 JS/TS 资源包，无安装期脚本和原生二进制 |
| 在 Pi `0.84.2` 上加载 | **Go（基础冒烟）** | Windows 本地加载成功，四个工具和 `/agents` 命令均注册 |
| 原样全局自动启用 | **No-Go** | trust、工具权限、多根会话、子会话资源继承未解决 |
| 受限单 Agent MVP | **Conditional Go** | 只在 trusted + default/full 中启用，宿主强制前台、工具上限和模型继承 |
| 作为受控 beta 功能 | **Conditional Go** | 完成 P0 适配并通过验收矩阵后可灰度 |
| 直接写入用户 Pi packages 配置 | **No-Go** | 这不是内置；会修改用户状态、产生版本漂移和卸载语义问题 |

## 2. 已核实事实

### 2.1 包身份、入口和兼容范围

Pi 包页面记录的当前版本为 `0.19.0`，发布日期为 2026-08-27，类型为 extension，许可证 MIT，解包大小约 2.3 MB；官方安装命令为 `pi install npm:@tintinweb/pi-subagents`。其 Pi manifest 只声明一个入口 `./src/index.ts`，不是传统 Node `main`/`exports` 入口。[Pi 包页面](https://pi.dev/packages/@tintinweb/pi-subagents?type=extension) [固定版本 package.json](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/package.json)

包的 peer 下限是 `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui >=0.84.0`；AteAgentV4 当前精确锁定三个 Pi 包为 `0.84.2`，版本区间匹配。[上游 package.json](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/package.json) [本项目 package.json](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/package.json#L49-L63)

Pi 官方说明支持两种相关加载方式：安装 npm package，或把文件/目录路径作为 extension source；manifest 内路径相对包根目录解析，TS 扩展由 `jiti` 加载，SDK 的 `DefaultResourceLoader` 支持 `additionalExtensionPaths`。因此不需要把插件注册为用户安装包，也能从应用自己的 `node_modules` 加载。[Pi packages 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/packages.md) [Pi extensions 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/extensions.md) [Pi SDK 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/sdk.md)

建议的实际加载链是：

```text
安装包
  └─ node_modules/@tintinweb/pi-subagents@固定版本
       └─ package.json -> pi.extensions -> src/index.ts
            └─ AteAgentV4 additionalExtensionPaths
                 └─ Pi / jiti 加载 -> 注册工具 -> 创建独立子 AgentSession
```

### 2.2 功能和运行模型

`0.19.0` 注册的核心表面为：

- `Agent`：启动或恢复前台/后台子 Agent；支持选择 Agent 类型、模型、上下文继承、调度和 worktree 隔离。
- `get_subagent_result`：查询/消费后台结果。
- `steer_subagent`：运行中注入消息。
- `SubagentWorkflow`：在 worker thread + `node:vm` 中运行编排脚本，提供 `agent()`、`parallel()`、`pipeline()`、`phase()` 等 API。
- `/agents`、widget、FleetView、会话 viewer、`@agent` mention、计划任务、跨扩展事件/RPC。

以上表面可由 [上游 README](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/README.md) 和 [入口源码](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/index.ts) 交叉确认。子 Agent 不是简单的一次模型调用：它为每个任务构造自己的 `SettingsManager`、`DefaultResourceLoader`、`SessionManager` 和 `AgentSession`，随后绑定扩展。[agent-runner.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-runner.ts#L747-L760) [agent-runner.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-runner.ts#L955-L1026)

后台 Agent 完成时，插件通过 `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` 把结果送回父会话并触发新一轮；这与 AteAgentV4 已有的“扩展注入运行可能没有 wrapper-level `prompt_done`”处理方向一致，但必须做真实 SSE/重连测试。[index.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/index.ts#L472-L527)

### 2.3 默认配置并不保守

插件上游默认包括：后台运行、后台并发 10、前台并发无限、最大轮数无限、嵌套深度 2、持久化子会话、写临时 transcript、允许 worktree、调度开启、Workflow 自动开启、模型 scope 关闭，以及未知类型回退到拥有全部工具的 `general-purpose`。`SubagentWorkflow` 本身会给每轮增加约 5k token 的工具描述，`Agent` 完整描述约 1,400 token。[README 的并发和设置说明](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/README.md#persistent-settings) [CHANGELOG](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/CHANGELOG.md)

这些并发值不是应用级总预算：`maxConcurrent` 只限制单个根会话的后台池，前台、嵌套、Workflow 和 schedule 还有独立或绕开该池的路径，多 Web 会话的并发还会相加。因此正式集成需要 AteAgentV4 自己的进程级 semaphore/配额，不能只调整插件 JSON。

`scopeModels: true` 也不是硬模型边界：调用方显式选择越界模型会报错，但 Agent frontmatter 固定模型和父模型继承只告警后继续。默认 `Explore` 还固定了 Anthropic Haiku。受限 MVP 应使用不固定模型的 ATE 自有 Agent 类型并继承父模型；完整版本则由宿主对参数、frontmatter、nested 和 workflow 全路径做一致的 hard policy。

默认 `general-purpose` 没有声明工具列表，源码解释为全部 7 个 Pi builtin；所谓只读的 `Explore`、`Plan` 列表仍包含 `bash`，只靠 system prompt 约束 Bash 不写文件，并非强权限边界。[default-agents.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/default-agents.ts#L9-L35) [agent-types.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-types.ts#L12-L22) [agent-types.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-types.ts#L285-L293)

### 2.4 配置和持久化位置

插件读取全局 `~/.pi/agent/subagents.json` 和项目 `<cwd>/.pi/subagents.json`，项目字段覆盖全局字段；`/agents` 设置界面只写项目文件。[settings.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/settings.ts#L1-L8) [settings.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/settings.ts#L467-L505)

其他落盘行为包括：

- 项目/全局自定义 Agent：`.pi/agents/*.md`、`.agents/agents/*.md` 和用户 Agent 目录。
- 顶层子 Agent 的 Pi session：默认持久化，并以父 session 文件建立关系。
- transcript/workflow 脚本和 journal：`<os tmp>/pi-subagents-<uid>/<encoded cwd>/<session>/tasks/`；Windows 无 `getuid()` 时 uid 段为 `0`。Unix 根目录强制 `0700`，Windows 的 `chmod` 不生效。[output-file.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/output-file.ts#L40-L60)
- 计划任务：`<cwd>/.pi/subagent-schedules/<sessionId>.json`，使用 PID lock 和临时文件 rename。[schedule-store.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/schedule-store.ts#L1-L10) [schedule-store.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/schedule-store.ts#L52-L64)
- 可选 memory 文件，以及 worktree 变更的自动 stage/commit/branch。

这些副作用意味着“仅把工具加到提示词”不是完整描述；安装包内置后还要向用户披露子会话、临时 transcript、Git 分支和项目 `.pi` 文件的行为。

### 2.5 依赖、二进制和供应链

npm `0.19.0` 元数据：

| 项 | 值 |
| --- | --- |
| tarball | `https://registry.npmjs.org/@tintinweb/pi-subagents/-/pi-subagents-0.19.0.tgz` |
| SHA-1 | `2af9a4b49d362d7c1e8e3769b4398b1a5b267ca6` |
| integrity | `sha512-DZsU33Urfb9dhEsJmsmpx0dayIHMYUbxng6AA7B6+bIgspNcTckcSnQRsbrv+QCS7jVKYJTzHIT/j1SU2B/nVQ==` |
| 文件数 / 解包大小 | 183 / 2,413,771 bytes |
| gitHead | `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`，与 `v0.19.0` tag 一致 |

来源为 [npm registry 固定版本元数据](https://registry.npmjs.org/@tintinweb%2Fpi-subagents/0.19.0) 和 [上游 `v0.19.0`](https://github.com/tintinweb/pi-subagents/tree/v0.19.0)。

直接运行时依赖只有 `@sinclair/typebox ^0.34.49`、`croner ^10.0.1`、`nanoid ^5.1.16`、`typebox ^1.3.7`；peer 由当前应用的 Pi `0.84.2` 满足。主包没有 `preinstall/install/postinstall`，没有 `bin`、`main` 或 `exports`。`nanoid` 依赖自身声明了一个纯 JavaScript CLI，npm 在 Windows 安装时可能为它生成 `.cmd/.ps1` shim，但插件源码没有调用该 CLI；这不属于随包携带的原生二进制。tarball 同时包含 `src` 和 `dist`，但 manifest 指向 `src/index.ts`，因此不能只复制 `dist`。[上游 package.json](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/package.json) [nanoid 固定版本元数据](https://registry.npmjs.org/nanoid/5.1.16)

对固定 tarball 的文件清单扫描未发现 `.exe/.dll/.so/.dylib/.node/.wasm/.cmd/.bat/.ps1/.sh`。源码也未发现直接 HTTP/WebSocket 客户端；模型网络请求走 Pi provider。它会调用宿主 `pi.exec("git", ...)`，Workflow 的 `gate` 会把模型/脚本提供的字符串交给 Windows `cmd /c` 或 Unix `sh -c` 执行。[worktree.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/worktree.ts#L64-L78) [workflow/host.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/workflow/host.ts#L155-L182)

2026-09-04 以 npm 官方 registry 安装生产依赖后，解析到的四个直接依赖均为 MIT，`npm audit --omit=dev` 报 0 个已知漏洞；这是时间点观察，不是未来版本保证，发行构建仍须生成 SBOM 并重新审计。

### 2.6 许可证和维护状态

主包为 MIT，允许复制、修改和再分发，但安装包及源码分发中必须保留版权和许可文本。[LICENSE](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/LICENSE)

项目活跃但仍年轻且处于 `0.x`：npm 从 2026-03-05 的 `0.2.0` 到 2026-08-27 的 `0.19.0` 共发布 56 个版本。调研时 `master` 为 `e955e29`，比 tag 多一个 lowercase `workflow` 冲突修复，说明即使短时间内也可能有已修复但未发布的行为差异。[npm 全量元数据](https://registry.npmjs.org/@tintinweb%2Fpi-subagents) [上游 CHANGELOG](https://github.com/tintinweb/pi-subagents/blob/master/CHANGELOG.md)

上游 CI 使用 Ubuntu + Node 22；严格验证 Pi `0.84.0` 下限，但对 Pi latest 的 job 是 `continue-on-error`，没有 Windows/macOS CI。因此“peer range 匹配”不能替代本项目的 Windows installer 验收。[上游 CI](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/.github/workflows/ci.yml)

## 3. 本地验证

在 Windows、当前项目已安装的 Pi `0.84.2` 上，以解开的 `0.19.0` package 根目录作为 `DefaultResourceLoader.additionalExtensionPaths` 做了加载冒烟。结果：无 loader error，注册工具 `Agent`、`SubagentWorkflow`、`get_subagent_result`、`steer_subagent`，注册命令 `/agents`。

对 tag 源码执行 `npm ci --ignore-scripts`、lint、typecheck 均成功；上游测试在当前 Windows 环境为 95 个文件通过、10 个文件失败，2100 tests 通过、26 失败、9 skipped。失败以 Windows 路径分隔符、CRLF、临时目录 EPERM 为主，并包含 worktree 路径断言，因此不能把上游 Ubuntu CI 当成 Windows 安装包验收，首发关闭 worktree 的决定也由此得到额外支持。

这只证明入口、TS 转译、直接依赖和 Pi API 在当前开发环境可加载；**没有**证明以下事项：实际模型调用、前后台子 Agent 执行、Web UI 渲染、SSE 断线重连、installer standalone trace、并发根会话、项目不可信状态、进程退出和 Git worktree。它们留在验收矩阵中。

## 4. 与 AteAgentV4 的关键冲突

### P0-1：项目 trust 没有传给子 Agent

AteAgentV4 创建根 session 时先计算项目可信状态，并以 `SettingsManager.create(..., { projectTrusted })` 以及 trust reload options 阻止不可信项目自动加载 `.pi/extensions`。[rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1681-L1695) [rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1723-L1727)

插件虽然能从 `ExtensionContext` 读取 `isProjectTrusted()`，但 `0.19.0` 没有使用它。它先构造未传 `settingsManager` 的 `DefaultResourceLoader`，稍后又调用未带 options 的 `SettingsManager.create(configCwd, agentDir)`。[Pi ExtensionContext 类型](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/extensions/types.ts#L307-L333) [agent-runner.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-runner.ts#L747-L759) [agent-runner.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-runner.ts#L955-L1000)

Pi `SettingsManager.create` 的默认值是 `projectTrusted: true`，`DefaultResourceLoader` 没收到 manager 时也会自行创建一个。因此子 Agent 会把项目 Pi 配置当成可信；插件本身还会直接读取项目 `subagents.json`、Agent、Workflow、Skill。上游安全策略明确假设用户只在可信仓库运行，和 AteAgentV4 支持“不信任项目”的宿主模型不同。[Pi settings-manager.ts](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/settings-manager.ts) [Pi resource-loader.ts](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/resource-loader.ts) [插件 SECURITY.md](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/SECURITY.md)

**要求**：不可信项目要么完全不加载此功能，要么所有项目级插件资源和子 loader 都继承 trust=false；不能只修 `SettingsManager` 而继续读取 `.pi/agents`/`.agents/agents`。

### P0-2：父会话工具预设不能约束子 Agent

AteAgentV4 的 `withExtensionTools()` 对任何非空 tool preset 都把全部扩展工具并入 active set；创建 session 时也故意只对空数组传 SDK allow-list。因此只读预设仍会激活 `Agent`。[rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L174-L184) [rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1709-L1720) [rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1818-L1823)

插件的 `general-purpose` 默认是所有 builtin + extension + skills；`Explore`/`Plan` 也带 `bash`。于是父会话的 read-only 不是能力上限。宿主必须把“子 Agent 能力不得超过父预设”作为硬约束，而不能依赖 Agent system prompt。

### P0-3：单进程多根会话假设不匹配

AteAgentV4 用进程级 `globalThis.__piSessions` 同时维护多个 `AgentSessionWrapper`，空闲 10 分钟才销毁。[rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L413-L423) [rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1451-L1470)

插件却把 manager 写到 `globalThis[Symbol.for("pi-subagents:manager")]`，并明确写着“first activation (the root session) wins”；这适配的是一个根 session 加其孩子，而不是多个并列根 session。[index.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/index.ts#L649-L681) 这个问题直接影响通过 Symbol 访问 manager 的跨扩展调用者；普通 `Agent` 工具闭包和会话自己的 `pi.events` 总线仍是按 activation 创建，不能把风险扩大描述成所有核心工具必然串会话，但完整 RPC/管理能力仍不能据此上线。

此外 Pi 的 extension loader 对同 cwd 缓存 factory，插件的 Agent registry、fallback、model scope、transcript/worktree 等若干设置存在模块级可变状态。同 cwd 的并发根会话可能共享这些状态。此处是从双方源码得到的风险推断，必须用双 session 测试证实；不能把它写成已发生的数据泄露。[Pi loader.ts](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/extensions/loader.ts) [agent-types.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/agent-types.ts#L24-L54) [model-scope.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/model-scope.ts)

### P0-4：宿主内置资源不会自动传给子 Agent

AteAgentV4 的 MCP adapter、场景 Skills、locale 和 Bash 包装器通过根 session 的 `additionalExtensionPaths` / `additionalSkillPaths` / `extensionFactories` 注入。[rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1696-L1707) [rpc-manager.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts#L1735-L1757)

插件子 session 新建自己的 loader，只会按 Pi 标准设置重新发现资源和 agent frontmatter 显式路径，不会拿到上述内存 factory/场景选择。必须提供“父 session 已授权资源快照”注入 hook，或首发明确禁止子 Agent 使用内置 MCP；不可在产品文案中声称它天然继承。

### P1：Web/RPC UI 和生命周期不等同于 TUI

插件主要 UI 是 pi-tui component。源码仅在 `ctx.mode === "tui"` 时注册 mention autocomplete/direct dispatch；AteAgentV4 使用 RPC session 和自定义 Web UI bridge，因此 Fleet 键盘交互和 `@` 补全不会自动出现在 React 前端。[index.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/index.ts#L786-L910)

插件在收到 `session_shutdown` 时会有界地中止并清理子会话，这一 teardown 方向与宿主兼容；真正缺口是 AteAgentV4 的 `isRunning()` 不统计后台 subagent。父 prompt 结束后，后台任务如果超过 10 分钟仍未完成，父 wrapper 可能被 idle shutdown 误杀；完成通知还要验证 `triggerTurn` 与 30 秒 SSE grace/reconnect 的组合。受限 MVP 因而应强制前台，完整后台能力要把 subagent/workflow 活跃计数纳入宿主 liveness。

计划任务的 JSON 能恢复，但计时器属于当前 extension/session 生命周期。AteAgentV4 会在空闲 10 分钟销毁 wrapper，故 schedule 不是应用级常驻调度器；首发必须关闭，除非改由应用拥有其生命周期。上游也注明 headless `pi -p` 不会等待 scheduled subagent。[README Scheduling](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/README.md#scheduling)

### P1：Workflow 是执行边界，不是安全沙箱

Workflow worker + `node:vm` 用于可终止性、确定性和防误操作；上游源码明确说明它不是抵御恶意脚本的安全边界。`gate` 还能直接调用系统 shell。Pi 官方也说明 extension 拥有与用户相同的系统权限，第三方包可执行任意代码。[worker-source.ts](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/src/workflow/worker-source.ts#L1-L32) [Pi packages 安全说明](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/packages.md#security)

另一个剩余风险是单次子 Agent 工具调用没有统一超时：`max_turns` 只会在一轮完成后推进，挂住的 MCP、浏览器、shell 或其他扩展工具可以长期占用并发槽。上游已有仍开放的 [per-tool timeout issue #150](https://github.com/tintinweb/pi-subagents/issues/150)。因此有限 turn 数不能替代宿主 wall-clock deadline、取消传播和 orphan 检测。

## 5. 方案对比

| 方案 | 做法 | 优点 | 主要问题 | 建议 |
| --- | --- | --- | --- | --- |
| A. 原版 npm 包 + `additionalExtensionPaths` | 精确依赖并把 package 根/入口传给 Pi | 改动最少，跟随上游，离线可用 | 无法强制 trust、parent capability、资源继承和保守默认；原样启用不安全 | 只可用于加载 PoC，不可直接发布默认开启 |
| B. 固定 npm 包 + ATE 受限 inline adapter | 用 `Proxy<ExtensionAPI>` 调用上游 factory，只重新注册一个被宿主包裹的 `Agent`；随包提供只读产品 profile | 不改上游即可验证核心价值；宿主可强制单 Agent、前台、模型继承、工具上限 | 明确不支持项目 Agent/设置、后台、Workflow、schedule、worktree、RPC、`/agents` 和 TUI UI；需要严格拦截注册面 | **推荐首个 opt-in MVP** |
| C. 精确 npm 包 + 宿主适配 + 哈希门控补丁 | 仍从 npm 锁包；小补丁增加 trust/scope/session hooks；宿主负责工具策略和资源桥 | 保留上游更新路径，差异小且可审计；类似现有 MCP patch 流程 | 升级需重放和复审补丁；需先写契约测试 | **推荐完整功能的短期方案** |
| D. 维护 fork/vendor | fork 后直接重构 session-scoped state 和 host API | 控制力最高，可做完整 Web 体验 | 0.x 快速迭代，长期合并、安全修复和许可清单成本最高 | 上游拒绝必要 hooks 时的后备方案 |
| E. 安装器执行 `pi install` 并写用户 settings | 安装时把包放进 `~/.pi/agent/npm` | 利用 Pi 原生 package 管理 | 需要网络或额外缓存；修改用户状态；用户 update 可越过应用验证；卸载/版本冲突复杂 | 不采用 |

方案 B 的 adapter 应由 Pi/Jiti 按路径、按会话加载上游 factory，并通过代理 API 裁掉工具、命令、输入事件和跨扩展 RPC；不能只用 `extensionsOverride` 在加载后删除，因为两个 factory 到那时已经执行，manager/timer 等副作用也已经产生。adapter 重新注册一个紧凑 `Agent` schema，强制 ATE 自有 Agent 类型、`isolated: true`、`extensions/skills: false`、`run_in_background: false`、有限 `max_turns`、无 model/worktree/schedule/resume 参数，并只在 trusted + default/full 中注入。产品 profile 可以随安装包放在应用根的受控 `.pi` 目录，由 launcher 固定的 app cwd 读取；运行时不得写该目录。

方案 C 中“补丁”不是随意改 node_modules。应像现有 MCP patch 一样：只针对精确 `0.19.0`，先验证文件内容/上游 commit，再做最小 patch；不匹配即构建失败。与此同时把改动提交给上游，成功合入后删除本地 patch。

## 6. 推荐分阶段改动

### Phase 0：先建立契约测试，不改变产品默认

涉及建议文件：新增 `lib/bundled-subagents*.test.mjs`、扩展 `lib/rpc-manager` 相关测试；不先改 UI。

1. 写两个并发根 session（同 cwd、不同 cwd）测试，验证 tool/manager/event/result 不串线。
2. 写 untrusted cwd 测试，在项目内放恶意/标记性 `.pi/settings.json`、`.pi/agents`、`.pi/extensions`、`.agents/skills`，确认根和子 session 均不加载。
3. 写四种工具预设能力矩阵，证明 child capability 不超过 parent。
4. 写 bundled MCP/scene resource 继承测试，先决定产品契约：继承已授权资源，还是首发明确隔离。
5. 写后台完成、`triggerTurn`、stop/shutdown、SSE 重连和 app idle eviction 测试。

Phase 0 的失败不是测试要“适配掉”，而是决定需要上游 hook 还是本地 patch 的证据。

### Phase 1：只做可重复、离线的分发

建议改动：

- `package.json` / `package-lock.json`：精确加入 `@tintinweb/pi-subagents: "0.19.0"`，不要 `^`；Pi peer 继续精确锁定。
- `scripts/patch-pi-subagents.cjs`：若 Phase 0 证明必须 patch，则校验 package version、gitHead/目标源码片段后应用；`postinstall` 执行，`prepack --check` 阻止陈旧依赖出包。
- `next.config.ts`：把 `@tintinweb/pi-subagents` 及其依赖闭包加入 standalone trace。当前代码只显式 trace `pi-mcp-adapter` 和 `jiti`，动态路径加载的包不会被 Next 静态发现。[next.config.ts](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/next.config.ts#L11-L50)
- installer/NOTICE：带上插件及生产依赖的 MIT notice、版本、integrity 和构建时 SBOM。
- 新建 `lib/bundled-subagents.ts`：只解析已安装 package 的 manifest/入口并返回绝对路径；不存在或版本不符时 fail closed。
- 在此阶段把包放进 installer，但 feature flag 默认关闭，验证断网冷启动。

不要在安装器中执行 `pi install`，也不要写 `~/.pi/agent/settings.json`。内置资源应属于应用，可升级、可回滚，不应伪装成用户安装的 package。

### Phase 2A：交付受限的 opt-in MVP

建议改动：

- 新建 `lib/bundled-subagents-adapter.ts`（名称可调整）：用独立 Jiti loader 取得固定版本 factory，并用 `Proxy<ExtensionAPI>` 拦截注册；只向 Pi 暴露宿主重新包装后的 `Agent`。
- 随安装包提供应用级只读 `.pi/subagents.json` 与 `.pi/agents/ate-*.md` profile：关闭 defaults/workflow/schedule/worktree/fleet/mentions/remember/transcript，Agent 不固定模型且 `extensions/skills` 均为 false。配置必须覆盖所有有副作用的字段，不能让用户全局 subagents 设置意外恢复能力。
- `Agent.execute` 包装器不接受或忽略 model/background/worktree/schedule/resume 等参数，按当前父 preset 选择 ATE 自有 Agent 类型，强制前台、`isolated: true` 和有限 turns。父 preset 改为 none/read-only 时不得再注册 Agent。
- 只在 `projectTrusted === true` 且 preset 为 default/full 时注入；宿主进程级 semaphore 设总并发 1 起步，并把 usage 汇总到父会话。
- 在构造 ResourceLoader 前预扫同名 global/project package。首发采用“用户版已启用则内置版拒绝启动并显示冲突”，不要双载，也不要静默卸载用户版。

这个阶段有意不支持项目自定义 Agent、`/agents`、后台 result/steer、跨扩展 RPC、内置 MCP 继承及所有 TUI 专属表面。任何一个被裁掉的注册面仍可触发，都属于 adapter 缺陷而不是“暂未做 UI”。

### Phase 2B：补齐宿主边界后接入完整 session 能力

建议改动：

- `lib/rpc-manager.ts`：把 bundled subagents path 与 MCP paths 一起传给 root loader，但由 feature/trust/tool preset 决定是否启用。
- 把 `withExtensionTools()` 从“任意非空预设加入所有 extension tools”改为有来源/能力分类的策略；至少 `none/read-only` 不得激活 `Agent` 和 `SubagentWorkflow`。
- 给插件增加 host context/hook：`projectTrusted`、父工具上限、`scopedModels`、根 session id、允许继承的 extension factories/skills，以及 app shutdown signal。
- 增加进程级总并发/成本 semaphore；插件自己的 background/foreground 数值只作为单会话内的第二层限制。
- 子 `SettingsManager` 和 `DefaultResourceLoader` 使用相同 trust；不可信项目不读任何项目级 subagents/agents/workflows/skills。
- 模型 scope 采取 hard policy：无论参数还是 agent frontmatter，越界都拒绝；插件原生“frontmatter 只警告仍运行”的语义不足以作为应用策略。
- manager registry 改为 `Map<rootSessionId, Manager>`，RPC 必须带/解析 root session；session shutdown 只移除自身。
- 处理用户已安装同名 package：必须在构造/加载 ResourceLoader **之前**预扫配置并决定只注入 bundled 或 user 版本之一；`extensionsOverride` 的事后过滤太晚，因为两个 factory 已经执行。首发可以显示“先停用用户版才能开启内置版”，不要静默删除用户配置。

上述 hook 优先上游化；本地 patch 只保留兼容胶水。

### Phase 3：Web 产品化

建议改动：

- `app/api`：新增只读 subagent 状态/详情接口，以及 stop/steer/result 的明确授权路由；不要把 TUI component 序列化成 Web UI。
- `hooks/useAgentSession.ts`：识别 subagent lifecycle/custom message，确保 `agent_settled`、后台 follow-up 和 run id reconciliation 不重复结束或复活旧 run。
- `components`：先做最小任务列表和状态 badge；再做 viewer/steer。`@` autocomplete、Fleet 键盘操作、Workflow inspector 作为后续独立功能，不宣称首发具备。
- `/api/plugins` / `PluginsConfig`：将其显示为只读的“内置组件”，不能通过普通 package update/remove；提供应用级开关和版本信息。
- 文档/CHANGELOG：明确权限、磁盘写入、并发、成本、MCP 继承和禁用方式。

### Phase 4：灰度和升级纪律

1. 先开发者开关，再 opt-in beta，再考虑 default/full 默认开启。
2. 每次升级固定版本，审查 `v旧..v新` 源码、manifest、依赖、lifecycle script、tarball hash 和许可证。
3. 对 Pi 升级做双向矩阵：当前插件 + 新 Pi、新插件 + 当前 Pi；不要依赖上游 `continue-on-error` latest CI。
4. 保留一键关闭与 installer 回滚；故障时只禁用 bundled path，不修改用户自己的 package 配置。

## 7. 建议首发默认配置

以下是 beta 的**默认值**，不是安全边界；项目 `subagents.json` 可覆盖插件设置，所以 trust、tool ceiling、model scope、并发总上限必须由宿主强制。

```json
{
  "maxConcurrent": 2,
  "maxConcurrentForeground": 1,
  "defaultMaxTurns": 20,
  "graceTurns": 3,
  "maxSubagentDepth": 1,
  "fallbackSubagent": "none",
  "backgroundByDefault": false,
  "schedulingEnabled": false,
  "workflowsEnabled": false,
  "scopeModels": true,
  "rememberAgents": false,
  "outputTranscript": false,
  "worktreeIsolation": false,
  "agentMentions": "off",
  "fleetView": false,
  "widgetMode": "off",
  "toolDescriptionMode": "compact",
  "reportUsage": true
}
```

宿主默认策略：

| 项 | beta 默认 |
| --- | --- |
| 安装包包含代码 | 是 |
| 功能总开关 | 关闭，开发者/用户显式 opt-in |
| 不可信项目 | 禁用 spawn/workflow，且不读取项目级插件资源 |
| `none` / `read-only` | 不激活 spawn/workflow；子能力不得越权 |
| `default` / `full` | 可激活 `Agent`、result、steer；Workflow 仍关闭 |
| MCP/场景 Skill | 未完成授权资源桥前不继承，并在 UI 明示 |
| 调度、Workflow、worktree | 首发关闭，分别验收后再开放 |

选择前台默认是为了让首发状态机可预测，避免后台 completion 自动触发下一轮造成成本惊喜；验证 Web follow-up 和并发配额后再考虑恢复上游的后台默认。关闭 transcript/session/worktree 是为了减少默认落盘，不妨碍用户在理解副作用后显式开启。

## 8. 验收矩阵

| ID | 场景 | 环境 | 通过标准 |
| --- | --- | --- | --- |
| P01 | 精确 tarball/lock | CI | version、integrity、gitHead 符合 allowlist；偏差立即失败 |
| P02 | 离线冷启动 | Windows installer，断网 | 包和四个直接依赖可解析，不访问 npm，不出现 loader error |
| P03 | standalone trace | 解压后的全新目录 | `src/index.ts`、所有运行依赖、worker source 均在包内且可加载 |
| S01 | 不可信项目 | cwd 内含标记性项目设置/Agent/extension/skill | 根与子 session 均不读取/执行；日志能解释禁用原因 |
| S02 | 工具预设 | none/read-only/default/full | none/read-only 无 spawn/workflow；child tools 永不超过 parent ceiling |
| S03 | model scope | enabledModels 限定两模型 | 参数、frontmatter、nested、workflow 路径均不能越界 |
| S04 | Workflow gate | Windows/Unix | 首发未注册；启用版需明确确认 shell 执行并受 trust/tool policy 约束 |
| I01 | 双根 session 同 cwd | 并行运行 | agent id、manager、设置、事件、结果、stop 不串线 |
| I02 | 双根 session 不同 cwd | 并行运行 | project agent/settings/resource 不互相污染 |
| I03 | 同名用户 package | global/project 各一 | 只绑定一个版本，无重复 handler/tool/notification |
| R01 | 内置 MCP 继承 | 有/无场景 MCP | 行为符合已选契约；不会发现父会话未授权资源 |
| R02 | 自定义 extension/skill | trusted/untrusted | 只加载父会话授权且 trust 允许的集合 |
| L01 | 前台 Agent | 实际 provider | streaming、abort、usage、错误归属正确，父 UI 一次完成 |
| L02 | 后台 Agent | SSE 断开/刷新/重连 | completion 只入库/触发一次；旧 run 事件不复活状态 |
| L03 | stop/shutdown | agent、workflow 运行中 | child session、worker、timer、git 操作可取消，无 orphan |
| L04 | 10 分钟 idle eviction | 有后台任务/无后台任务 | 运行中不被误杀；空闲释放；调度关闭时无残留 timer |
| F01 | Git / 非 Git cwd | Windows 长路径、空格、中文 | isolation 关闭时不调用 git；开启后失败可解释且清理完整 |
| U01 | Web 最小 UI | Chrome/Edge | 状态、查看结果、stop、steer 可用；TUI-only 功能不虚假展示 |
| C01 | 成本与限制 | 并发/嵌套压力 | 总并发、轮次、深度硬限制有效；usage 纳入父 session |
| X01 | 回滚 | 从启用版降级 | 关闭 bundled path 即恢复，用户 packages/settings 不被改写 |

## 9. Go / No-Go 门槛

### 允许进入 opt-in beta 的 Go 条件

- P01/P02/P03 全过，installer 可完全离线加载。
- S01/S02/S03 全过：trust、父能力上限、模型 scope 都是强制边界。
- I01/I02/I03 全过：多根会话和重复安装不串线、不重复绑定。
- L01/L02/L03 全过：前后台完成、取消、shutdown、SSE 只产生一次终态。
- 默认配置确实禁用 Workflow、schedule、worktree 和 TUI-only 表面。
- MIT notice、SBOM、版本/integrity 和用户可见权限说明随安装包发布。

### 保持 No-Go 的任一条件

- 子 Agent 在不可信 cwd 能加载任何项目级可执行 extension、Agent/Skill 指令或配置。
- read-only/none 父会话能间接获得 bash/write/edit 或任意未授权 extension/MCP。
- 跨根 session 的 result/stop/RPC 可命中另一个根 session。
- installer 依赖联网安装或 Next standalone 漏掉动态依赖。
- 后台任务在刷新、SSE 重连或 idle shutdown 后重复触发、丢终态或留下 orphan。
- 无法确保只加载 bundled/user 两个版本中的一个。

内置 MCP 继承若首发明确标为“不支持”且默认隔离，可作为 P1 后续项；但若产品卖点包含“子 Agent 可用内置 MCP”，则 R01/R02 也必须升为 beta 前的 P0 门槛。Workflow、schedule、worktree 也应各自通过专项安全与生命周期验收后单独放开，不随 `Agent` 基础能力一起默认开启。

## 10. 最终建议

批准“把固定版本代码放进安装包”的工作；暂不批准“原版插件随所有会话自动启用”。先执行 Phase 0 和 Phase 1，再以方案 B 的受限 adapter 交付 opt-in 单 Agent MVP：它的目标不是复刻 TUI，而是得到一个可离线加载、可关闭、权限不越界的基础能力。与此同时向上游提交 trust、parent capability、resource injection 和 root-session keyed manager hooks；需要完整功能时转入方案 C，若 1–2 个上游发布周期内仍无法合入，再以最小 fork 落地，并把同步成本列为长期维护预算。

## 11. 一手来源

- [Pi package 页面：`@tintinweb/pi-subagents`](https://pi.dev/packages/@tintinweb/pi-subagents?type=extension)
- [npm registry：固定版本 `0.19.0`](https://registry.npmjs.org/@tintinweb%2Fpi-subagents/0.19.0)
- [npm registry：全版本时间线](https://registry.npmjs.org/@tintinweb%2Fpi-subagents)
- [npm registry：`nanoid@5.1.16`](https://registry.npmjs.org/nanoid/5.1.16)
- [上游源码：`v0.19.0`](https://github.com/tintinweb/pi-subagents/tree/v0.19.0)
- [上游 README](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/README.md)
- [上游 SECURITY](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/SECURITY.md)
- [上游 LICENSE](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/LICENSE)
- [上游 CI](https://github.com/tintinweb/pi-subagents/blob/v0.19.0/.github/workflows/ci.yml)
- [Pi `0.84.2` packages 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/packages.md)
- [Pi `0.84.2` extensions 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/extensions.md)
- [Pi `0.84.2` SDK 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/sdk.md)
- [Pi `0.84.2` extension loader 源码](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/extensions/loader.ts)
- [Pi `0.84.2` settings manager 源码](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/settings-manager.ts)
- [AteAgentV4 当前基线 `rpc-manager.ts`](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/lib/rpc-manager.ts)
- [AteAgentV4 当前基线 `next.config.ts`](https://github.com/aniping/AteAgentV4/blob/18aaecafa82f1abc162341854783e07bc8ac9a83/next.config.ts)

### 调研复现说明

给定网页首先按要求使用 Defuddle CLI 提取：

```powershell
defuddle parse 'https://pi.dev/packages/@tintinweb/pi-subagents?type=extension' --md
```

随后用 npm 官方 registry 的固定版本元数据、`npm pack --dry-run --json`、实际 tarball 内容、`v0.19.0` tag 与 Pi `v0.84.2` 官方源码交叉核验。没有把第三方博客、聚合站或搜索摘要作为结论依据。
