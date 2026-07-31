# ATE Agent

ATE Agent 是面向无线装备研发与调试场景的本地智能助手，基于 [pi coding agent](https://github.com/badlogic/pi-mono) 提供浏览器工作界面。

它可以管理本机会话、实时对话、模型配置、Skill 与插件，并支持浏览项目文件、Git 状态和 Worktree。

各版本的新增能力、体验改进和问题修复见 [ATE Agent 版本特性](./CHANGELOG.md)。

> [!WARNING]
> ATE Agent 可以调用本机工具和高权限智能体。默认不启用密码认证；不要直接暴露到互联网，局域网访问仅限可信网络。

## 快速开始：使用 Windows 安装程序

已经拿到发布包时，直接运行：

```text
ATE-Agent-Setup-<版本>-win-<架构>.exe
```

安装程序默认安装到 `C:\Program Files\ATEAgent`，并创建桌面快捷方式、开始菜单快捷方式和卸载入口。安装完成、双击带有红色图标的 `ATE-Agent.exe` 或快捷方式时都会显示 ATE Agent 状态主界面，不会自动打开网页；已经运行时再次双击只会唤醒主界面，不会重复启动 Node。

`ATE-Agent.exe` 会在服务运行期间保持常驻。状态主窗口分别显示 Agent 与 UI 版本，用户点击“打开 ATE Agent 工作台”后才会打开网页。双击托盘红色图标会显示主窗口；托盘右键可以打开网页、显示运行状态、重启服务或退出。显示主窗口时，带红色图标的任务栏项会同时出现；关闭窗口会将它隐藏回托盘并移除任务栏项，但不会停止服务。结束 `ATE-Agent.exe` 会同步结束其 Node 和工具子进程。`start.cmd` 仅作为兼容入口保留；也可以双击安装目录中的 `stop-all-server.exe` 停止全部相关进程。

内置运行时按类型放置在 `runtime` 下；当前 Node.js 位于 `runtime\node`，以后增加其他运行时不会与 Node.js 文件混放。覆盖升级、同版本修复安装和回退到旧版都会替换内置 Node.js 与应用目录，因此 Node.js 和 Agent 会切换为目标安装包所带版本；用户 `.pi` 目录中的会话、Skill、插件和配置不会被覆盖。

安装目录按用途划分：根目录只保留启动、停止、卸载和说明入口；`app` 存放 Web 应用，`runtime\node` 存放 Node.js，`support` 存放启动器内部文件。构建阶段使用的独立 ICO 文件不会安装到目标电脑。

安装完成后双击 **ATE Agent** 快捷方式，本机浏览器访问：

```text
http://127.0.0.1:30141
```

安装版默认监听 `0.0.0.0:30141`。同一可信局域网中的其他电脑可访问：

```text
http://<运行 ATE Agent 电脑的局域网 IP>:30141
```

首次运行时，Windows 防火墙可能询问是否允许网络访问。当前本地构建的安装程序未进行代码签名，Windows 可能显示“未知发布者”；只安装来自可信来源的构建。

目标电脑不需要安装 Node.js、NSIS 或 PowerShell。安装程序已经包含 Node.js、npm 和 npx。

## 快速开始：源码开发运行

开发环境需要：

- Node.js 22.19.0 或更高版本
- npm
- Git（使用 Git 状态与 Worktree 功能时需要）

在项目目录打开 CMD，执行：

```cmd
npm install
npm run dev
```

开发服务默认只监听本机：

```text
http://127.0.0.1:30141
```

需要从可信局域网访问开发服务时，改用：

```cmd
npm run dev:lan
```

不要把 `npm run dev` 与 `npm run build`、`npm run package` 同时运行。生产构建会更新 `.next`，可能干扰正在运行的开发服务。

## 构建 Windows 安装程序

安装包使用 [NSIS 3.12](https://nsis.sourceforge.io/Download) 生成。构建电脑需要 Windows x64 或 arm64、Node.js 22.19.0 及 NSIS 3.12。

在 CMD 中通过官方 Winget 源安装 NSIS：

```cmd
winget install --id NSIS.NSIS -e -s winget
```

如果 `makensis.exe` 不在默认位置，先设置完整路径：

```cmd
set NSIS_MAKENSIS=D:\Tools\NSIS\makensis.exe
```

然后执行：

```cmd
npm install
npm run package
```

输出文件位于：

```text
build\release\ATE-Agent-Setup-<版本>-win-<架构>.exe
```

构建脚本入口是 `scripts\package-installer.cmd`，内部使用 Node.js 完成构建、下载、SHA-256 校验和文件整理，不依赖 PowerShell。

构建会嵌入与当前电脑同架构的官方 Node.js 发行版。Node.js 压缩包会缓存到 `build\node-runtime`，后续打包无需重复下载。

打包流程只会移除不影响运行的说明文档、源码映射和重复嵌套的 Mistral SDK，并校验 Node.js、npm/npx、pi 运行包及关键资源完整性。这样可以缩小体积，同时保留离线运行、后续 Node.js/pi 升级以及 Skill、插件安装与更新能力。脚本还会校验默认安装路径长度，防止生成在 Windows 上无法复制或安装的长路径文件。

## 运行参数与代理

源码方式可使用以下命令：

```cmd
npm run start
npm run start:lan
```

兼容的运行变量：

```cmd
set PORT=8080
set PI_WEB_HOSTNAME=0.0.0.0
set PI_WEB_ALLOWED_HOSTS=ate-agent.internal
set PI_WEB_PASSWORD=请替换为足够长的随机密码
set PI_WEB_NO_OPEN=1
```

设置非空的 `PI_WEB_PASSWORD` 后，网页和 API 会启用 HTTP Basic Auth，用户名固定为 `pi`。Basic Auth 不加密传输内容；远程访问必须通过可信的 HTTPS 反向代理或 VPN，不能把普通 HTTP 服务直接暴露到互联网。未设置或设置为空时不启用认证。

服务端模型与 API 请求会读取标准代理变量：

```cmd
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
set NO_PROXY=localhost,127.0.0.1
npm run dev
```

`PI_WEB_*` 和 `pi-web` CLI 名称暂时保留，用于兼容上游配置和已有自动化；用户界面品牌为 ATE Agent。

## 数据目录与默认工作目录

- 会话和配置继续存放在 `~/.pi/agent`，不会创建或迁移到 `~/.ate`。
- 会话默认位于 `~/.pi/agent/sessions`。
- 模型配置位于 pi agent 数据目录下的 `models.json`。
- 可通过 `PI_CODING_AGENT_DIR` 指定其他 pi agent 数据目录。
- 新会话的日期工作目录默认为 `~/ate-cwd-YYYYMMDD`。
- 项目级 Skill 位于 `.pi/skills`，全局 Skill 位于 `~/.pi/agent/skills`。

卸载 ATE Agent 只删除安装目录、快捷方式和卸载注册信息，不删除 `~/.pi/agent` 中的会话、模型或 Skill 数据。

## 主要功能

- **会话管理**：按项目浏览、恢复、重命名、删除和分支会话。
- **实时对话**：通过 SSE 接收模型输出、工具调用、思考过程和状态更新。
- **双语提示词**：SDK 默认系统提示词跟随界面语言使用中文或英文，并统一使用 ATE Agent 品牌；项目自定义提示词和兼容性技术标识保持原样。
- **模型配置**：可通过预置的 AteTest、Ascend 内部端点或自定义端点添加 Provider，并管理 API 地址、API Key、自定义模型和 Thinking 等级；还可导入上游模型并从 models.dev 补全模型信息与价格。
- **本地 API**：支持无需 API Key 的兼容接口配置与连通性测试。
- **上下文管理**：显示 Token、费用与上下文占用，并提供压缩反馈。
- **对话导航**：通过可拖动的小地图快速定位长会话中的消息与工具调用。
- **可调节布局**：桌面端可拖动左右分隔线调整侧边栏和文件面板宽度；拖近边缘可收起面板，重新打开时恢复上次宽度。
- **文件浏览**：预览源码、Diff、图片、音频、PDF 和 DOCX。
- **Git 与 Worktree**：显示仓库状态，筛选并切换多个工作树。
- **PWA**：支持安装到桌面或主屏幕，并在本地服务暂时不可用时显示 ATE Agent 离线页；前端静态资源采用网络优先、缓存回退策略，更新后不会继续使用旧版本页面。
- **Skill 管理**：搜索、安装、上传、更新、启停和卸载 Skill。
- **插件管理**：安装和管理 pi 扩展包，并提供官方扩展目录入口。
- **集成安装包**：支持包含 Skill、运行时和可选 MCP 服务的通用 ZIP。

## Skill 与集成 ZIP

完整制作流程见 [Skill 与集成 ZIP 制作指南](./docs/skill-packages.zh-CN.md)。

普通 Skill ZIP 可以带一层包装目录，但包内必须只有一个 `SKILL.md`，且不能在 Skill 目录外放置文件：

```text
my-skill.zip
└── my-skill\
    ├── SKILL.md
    ├── scripts\
    └── references\
```

需要携带运行时或 MCP 服务时，使用根目录清单 `ateagent-integration.json`，并用 `SHA256SUMS.json` 列出其他文件的 SHA-256。

```json
{
  "schemaVersion": 1,
  "id": "debug-tools",
  "version": "1.0.0",
  "platform": "win32",
  "arch": "x64",
  "skill": { "name": "debugging", "path": "skill/debugging" },
  "mcp": {
    "serverName": "debug-server",
    "executable": "runtime/server.exe",
    "args": []
  }
}
```

`platform`、`arch`、`mcp.args` 和 `mcp.env` 可以省略。MCP 工具通过协议自动发现，不需要在清单中枚举工具名。

上传限制为 ZIP 512MB、解压内容 1GB。安装器会拒绝危险路径、符号链接、校验和不匹配、多 Skill、平台或架构不兼容，以及覆盖已有目标的压缩包。

上传安装阶段不会执行压缩包中的程序，但 Agent 后续可能运行集成运行时。只安装可信来源的 Skill 与集成包。

## 开发与验证

常用命令：

```cmd
npm run dev
npm run lint
npx tsc --noEmit
npm run build
npm run package
```

打包相关测试：

```cmd
node --test scripts\portable-build-preload.test.mjs scripts\portable-launcher.test.mjs
```

## 项目结构

```text
app\                    Next.js 页面与 API 路由
components\             会话、对话、模型、Skill 和文件界面
hooks\                  对话、主题、拖放与音频等前端状态
lib\                    会话、Agent、文件、安全和配置逻辑
scripts\                Windows 安装器与构建脚本
public\                 静态资源
docs\                   使用与安装包制作文档
bin\pi-web.js           兼容的 npm CLI 入口
next.config.ts          Next.js 与 standalone 构建配置
```

## 许可证

本项目沿用 MIT License。第三方模型 SDK、Node.js、NSIS 与其他依赖遵循各自许可证。
