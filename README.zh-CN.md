# Pi Web

[English](./README.md) | [日本語](./README.ja.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地网页界面。它会读取本机的 pi 会话文件，在浏览器里提供会话管理、实时对话、模型配置、技能管理和项目文件预览。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

## 快速开始

Pi Web 要求 Node.js 22.19.0 或更高版本。可通过 `node --version` 检查当前版本。

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。命令行版本会在服务就绪后尝试自动打开浏览器。Pi Web 默认仅监听 `127.0.0.1`。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 在可信网络中开放访问
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式开放网络访问
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # 允许指定的代理或自定义主机名
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

Pi Web 没有应用层身份验证，并且可以调用高权限智能体。请勿将其暴露到互联网；仅在可信网络中使用非 loopback 监听地址。
API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PI_WEB_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

### Windows 便携发布包

在 Windows x64 或 arm64 上运行 `npm run package`，会在 `build/release/` 生成同架构的便携 ZIP。产物包含生产版应用，以及经过官方 SHA-256 校验、带 npm/npx 的完整 Node.js 发行目录，目标电脑无需另外安装 Node.js。

解压后双击 `start.cmd`。便携包默认监听 `0.0.0.0:30141`，同一可信局域网中的其他电脑可打开 `http://<运行电脑的局域网 IP>:30141`。需要仅限本机时运行 `start.cmd -H 127.0.0.1`；自定义端口可使用 `start.cmd -p 8080`。Windows 防火墙可能需要允许所选端口入站访问。

## HTTP 代理

Pi Web 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [Pi Web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

## Skill ZIP 安装包

完整的目录规范、清单字段、PowerShell 7 打包模板、校验流程和升级方式，见 [Skill 与集成 ZIP 制作指南](./docs/skill-packages.zh-CN.md)。

Skills 面板支持把本地 ZIP 安装到全局作用域（`~/.pi/agent/skills`）或项目作用域（`.pi/skills`）。普通技能包可以带一层包装目录，但必须只包含一个 `SKILL.md`，且不能在技能目录外放置其他文件：

```text
my-skill.zip
└── my-skill/
    ├── SKILL.md
    ├── scripts/
    └── references/
```

需要携带运行时的安装包使用下面的通用集成格式。根目录的 `ateagent-integration.json` 声明技能和可选的 stdio MCP 服务；`SHA256SUMS.json` 必须列出压缩包内除此文件之外每个文件的 SHA-256：

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

`platform`、`arch`、`mcp.args` 和 `mcp.env` 可省略。MCP 会通过协议自动发现工具，新包无需在清单里枚举工具名。带 MCP 的集成包会在需要时按所选作用域安装并配置 `pi-mcp-adapter`。ZIP 安装的技能可在详情页卸载；卸载会同时移除该安装包的集成运行时和它拥有的 MCP 服务配置，但保留可被其他集成共用的适配器包。上传校验会拒绝危险路径、符号链接、校验和不匹配、平台或架构不兼容、包含多个技能、目标已存在、超过 512MB 的 ZIP，以及解压后超过 1GB 的内容。安装阶段不会执行上传的程序；Pi 后续可能运行包内运行时，因此请只安装可信来源的 ZIP。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30141](http://127.0.0.1:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  DirectoryPicker.tsx # 支持浏览和路径输入的工作目录选择器
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  pi-web.js           # npm CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
