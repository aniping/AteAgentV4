# Skill 与集成 ZIP 制作指南

本文说明如何制作可从 AteAgent Skills 面板上传的普通 Skill 包和集成包。普通 Skill 包只包含提示词、脚本和参考资料；集成包还可以携带本地运行时，并自动注册一个 stdio MCP 服务。

## 目录

- [选择包类型](#选择包类型)
- [准备 SKILL.md](#准备-skillmd)
- [制作普通 Skill 包](#制作普通-skill-包)
- [制作集成包](#制作集成包)
- [生成校验和与 ZIP](#生成校验和与-zip)
- [安装后的落盘位置](#安装后的落盘位置)
- [发布前验证](#发布前验证)
- [版本升级](#版本升级)
- [限制与常见错误](#限制与常见错误)

## 选择包类型

| 需求 | 包类型 | 必需文件 |
| --- | --- | --- |
| 只提供操作说明、工作流、脚本或参考资料 | 普通 Skill 包 | 一个 `SKILL.md` |
| 同时分发可执行程序、服务端或其他运行时文件 | 集成包 | `SKILL.md`、`ateagent-integration.json`、`SHA256SUMS.json` |
| 安装后自动接入 MCP 工具 | 带 MCP 的集成包 | 集成包文件，以及清单中的 `mcp` 配置和对应可执行文件 |

能用普通 Skill 包时优先使用普通包。只有确实需要随包安装运行时代码时，才使用集成包。

## 准备 SKILL.md

每个包必须恰好包含一个 `SKILL.md`。推荐的技能目录如下：

```text
my-skill/
├── SKILL.md
├── scripts/       # 可选：确定性脚本
├── references/    # 可选：按需读取的详细资料
└── assets/        # 可选：模板、图片等输出素材
```

最小 `SKILL.md`：

```markdown
---
name: my-skill
description: 指导智能体完成某类任务；当用户提出相关需求时使用。
---

# My Skill

按照以下步骤完成任务：

1. 检查输入。
2. 执行工作流。
3. 验证结果。
```

要求：

- `name` 必填，最多 64 个字符，只能使用小写字母、数字和单个连字符；例如 `my-skill`。
- `description` 必填，不能为空，最多 1024 个字符。应同时说明技能做什么以及何时触发。
- 文件夹名称最好与 `name` 相同。
- 技能正文只写智能体完成任务所需的内容；较长的资料放进 `references/`，重复执行且需要稳定结果的逻辑放进 `scripts/`。

## 制作普通 Skill 包

普通 Skill ZIP 可以直接以 `SKILL.md` 为根，也可以保留技能文件夹作为一层包装目录。推荐保留文件夹：

```text
my-skill-1.0.0.zip
└── my-skill/
    ├── SKILL.md
    ├── scripts/
    └── references/
```

ZIP 内不能存在第二个 `SKILL.md`，也不能在 `my-skill/` 外放置其他文件。

在 PowerShell 7 中打包：

```powershell
$skillRoot = [IO.Path]::GetFullPath('.\skills\my-skill')
$output = [IO.Path]::GetFullPath('.\dist\my-skill-1.0.0.zip')

if (-not (Test-Path -LiteralPath $skillRoot -PathType Container)) {
    throw "Skill directory does not exist: $skillRoot"
}
if (Test-Path -LiteralPath $output) {
    throw "Output already exists: $output"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
Compress-Archive -LiteralPath $skillRoot -DestinationPath $output -CompressionLevel Optimal
```

这里使用 `-LiteralPath $skillRoot`，因此 ZIP 会保留 `my-skill/` 这一层目录。

## 制作集成包

集成包的清单和校验和文件必须位于 ZIP 根目录。推荐结构：

```text
my-integration-1.0.0-win32-x64.zip
├── ateagent-integration.json
├── SHA256SUMS.json
├── skill/
│   └── my-skill/
│       ├── SKILL.md
│       └── references/
└── runtime/
    └── win-x64/
        └── my-mcp-server.exe
```

### 集成清单

`ateagent-integration.json` 示例：

```json
{
  "schemaVersion": 1,
  "id": "my-integration",
  "version": "1.0.0",
  "platform": "win32",
  "arch": "x64",
  "skill": {
    "name": "my-skill",
    "path": "skill/my-skill"
  },
  "mcp": {
    "serverName": "my-mcp-server",
    "executable": "runtime/win-x64/my-mcp-server.exe",
    "args": ["--stdio"],
    "env": {
      "LOG_LEVEL": "info"
    },
    "requiredTools": ["inspect_state", "run_action"]
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 当前固定为数字 `1`。 |
| `id` | 是 | 集成标识，最多 64 个字符；规则与 Skill 名称相同。 |
| `version` | 是 | 非空字符串，最多 64 个字符；建议使用语义化版本。 |
| `platform` | 否 | Node.js 平台名，例如 `win32`、`linux`、`darwin`。填写后只能安装到相同平台。 |
| `arch` | 否 | Node.js 架构名，例如 `x64`、`arm64`。填写后只能安装到相同架构。 |
| `skill.path` | 是 | ZIP 内技能目录的相对路径，使用 `/`；该目录必须包含唯一的 `SKILL.md`。 |
| `skill.name` | 否 | 填写时必须与 `SKILL.md` 的 `name` 完全一致。建议填写。 |
| `mcp` | 否 | 省略时只安装 Skill 和集成运行时，不注册 MCP。 |
| `mcp.serverName` | `mcp` 存在时 | MCP 服务名称，1–64 个字符，可使用字母、数字、点、下划线和连字符。 |
| `mcp.executable` | `mcp` 存在时 | ZIP 内可执行文件的相对路径；文件必须真实存在。 |
| `mcp.args` | 否 | 启动可执行文件时原样传入的字符串数组。 |
| `mcp.env` | 否 | 注入进程的环境变量，键和值都必须是字符串。不要把密钥写进发布包。 |
| `mcp.requiredTools` | 否 | 允许直接暴露给智能体的 MCP 工具名。省略或留空表示暴露服务提供的全部工具。 |

当前解析器只使用上表字段。额外字段可能会被忽略，不要依赖它们影响安装或界面展示。

### MCP 运行时要求

- 服务必须通过标准输入和标准输出使用 stdio MCP 协议。
- 标准输出只用于 MCP 协议消息；诊断日志应写入标准错误。
- `requiredTools` 中的名称必须与服务实际公布的工具名一致，每项不能为空、不能包含空白且最多 128 个字符。
- Windows 建议分发自包含 `.exe`；Linux 和 macOS 应分发带正确 shebang 的可执行文件。安装器会在非 Windows 平台为清单指定的文件补充执行权限。
- 一个清单只能声明一个平台、架构和 MCP 可执行文件。需要支持多个系统时，应分别生成不同 ZIP，并正确填写 `platform` 和 `arch`。
- 不要通过省略 `platform` 或 `arch` 来伪装可移植性；只有运行时确实跨平台时才省略。

带 MCP 的集成包安装时会检查当前作用域是否已有可用的 `pi-mcp-adapter`，没有时自动安装。卸载集成包不会移除这个共享适配器。

## 生成校验和与 ZIP

集成包必须提供 `SHA256SUMS.json`。它必须列出 ZIP 内除自身以外的每一个文件，包括：

- `ateagent-integration.json`
- `SKILL.md` 和技能目录内的所有文件
- 所有运行时和资源文件

路径必须相对 ZIP 根目录并使用 `/`。摘要必须是 64 位十六进制 SHA-256。文件集合必须完全匹配：少一个、多一个或内容变化都会导致安装失败。

下面的 PowerShell 7 模板假设 `$stageRoot` 已经包含完整集成包内容，但还没有 `SHA256SUMS.json`：

```powershell
$stageRoot = [IO.Path]::GetFullPath('.\build\my-integration-package')
$output = [IO.Path]::GetFullPath('.\dist\my-integration-1.0.0-win32-x64.zip')
$checksumPath = Join-Path $stageRoot 'SHA256SUMS.json'

if (-not (Test-Path -LiteralPath (Join-Path $stageRoot 'ateagent-integration.json') -PathType Leaf)) {
    throw 'ateagent-integration.json is missing from the staging root.'
}
if (Test-Path -LiteralPath $checksumPath) {
    throw "Remove the stale checksum file before packaging: $checksumPath"
}
if (Test-Path -LiteralPath $output) {
    throw "Output already exists: $output"
}

$files = [ordered]@{}
Get-ChildItem -LiteralPath $stageRoot -File -Recurse |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
        $files[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }

[ordered]@{
    schemaVersion = 1
    files = $files
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $checksumPath -Encoding UTF8

New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
Compress-Archive `
    -Path (Join-Path $stageRoot '*') `
    -DestinationPath $output `
    -CompressionLevel Optimal
```

必须最后生成校验和。生成后不要再修改、增加或删除暂存目录中的任何其他文件；如有修改，应删除旧的 `SHA256SUMS.json` 并重新计算。

`Compress-Archive -Path (Join-Path $stageRoot '*')` 会把暂存目录的内容放在 ZIP 根目录，而不会把暂存目录本身包进去。

## 安装后的落盘位置

假设 Skill 名为 `my-skill`，集成 ID 为 `my-integration`：

| 内容 | 项目作用域 | 全局作用域 |
| --- | --- | --- |
| Skill | `<项目>/.pi/skills/my-skill` | `<agentDir>/skills/my-skill` |
| 集成运行时 | `<项目>/.pi/integrations/my-integration` | `<agentDir>/integrations/my-integration` |
| 安装收据 | `<项目>/.pi/skill-archives/my-skill.json` | `<agentDir>/skill-archives/my-skill.json` |
| MCP 配置 | `<项目>/.pi/mcp.json` | `<agentDir>/mcp.json` |

集成运行时目录中会保留 ZIP 的完整文件结构。MCP 配置的 `command` 会指向其中的 `mcp.executable`。

## 发布前验证

### 1. 检查 ZIP 目录

```powershell
$zipPath = [IO.Path]::GetFullPath('.\dist\my-integration-1.0.0-win32-x64.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $archive.Entries | ForEach-Object FullName
}
finally {
    $archive.Dispose()
}
```

确认清单和校验和位于根目录，路径使用 `/`，且没有意外的构建缓存、密钥或本机配置。

### 2. 检查制作约束

- ZIP 中恰好有一个 `SKILL.md`。
- `SKILL.md` 的 `name`、清单的 `skill.name` 和预期安装目录一致。
- `skill.path` 精确指向包含 `SKILL.md` 的目录。
- `mcp.executable` 指向 ZIP 内真实存在的文件。
- `requiredTools` 与 MCP 服务公布的工具名逐一一致。
- `SHA256SUMS.json` 覆盖除自身外的全部文件。
- 包内不含密码、API key、私钥或用户机器专属配置。

### 3. 实机验证完整生命周期

建议先选择一个测试项目并安装到项目作用域：

1. 在 Skills 面板上传 ZIP，确认安装成功。
2. 新建或刷新会话，确认 Skill 能被发现。
3. 对带 MCP 的集成包，确认服务已连接，并实际调用一个只读工具。
4. 在 Skill 详情中卸载，确认 Skill、集成运行时和所属 MCP 配置都被移除。
5. 再次上传同一个 ZIP，确认可以重新安装和使用。

## 版本升级

当前安装器不会覆盖已有的 Skill、集成目录、安装收据或同名 MCP 服务。因此发布新版本时：

1. 修改清单中的 `version`。
2. 重新构建运行时和技能文件。
3. 最后重新生成完整校验和。
4. 使用带版本和平台信息的 ZIP 文件名，例如 `my-integration-1.1.0-win32-x64.zip`。
5. 在 AteAgent 中先卸载旧版本，再上传新版本。

`version` 当前用于描述包版本，不会触发原地升级。

## 限制与常见错误

| 限制或错误 | 处理方式 |
| --- | --- |
| ZIP 超过 50 MiB | 缩小运行时，移除调试符号、缓存和无关资源。 |
| 解压后总大小超过 128 MiB | 拆分或精简运行时。 |
| 单个文件超过 64 MiB | 缩小或拆分该文件。 |
| ZIP 条目超过 512 个 | 合并或删除零散资源；目录条目也计入总数。 |
| `Archive must contain exactly one SKILL.md` | 删除重复技能，确保一个 ZIP 只安装一个 Skill。 |
| `Plain skill archives cannot contain files outside...` | 把普通包的全部文件移动到 Skill 根目录内。 |
| `Manifest skill.path must point...` | 修正 `skill.path`，使其精确指向唯一 `SKILL.md` 所在目录。 |
| `SHA256SUMS.json must list every archive file...` | 在所有文件定稿后重新生成完整校验和。 |
| `SHA-256 mismatch` | 文件在计算摘要后发生变化；重新生成摘要和 ZIP。 |
| `Integration requires platform/architecture...` | 上传与当前机器匹配的构建，或重新制作对应平台的 ZIP。 |
| `MCP executable is missing` | 修正 `mcp.executable` 或把构建产物复制到清单声明的位置。 |
| `already exists` | 先从 Skill 详情卸载旧版本，再重新安装。 |

所有 ZIP 路径都必须是相对路径、使用 `/`，并且不能包含空段、`.`、`..`、盘符、反斜杠、NUL 字符、大小写冲突的重复路径或符号链接。
