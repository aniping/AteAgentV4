# Wireless ATE Agent 内置资源

此目录是安装包内置 Agent、Skill 与场景 MCP 的唯一资源入口。`bundle.json` 定义五个场景及其资源路径；打包脚本会校验并完整复制本目录。

后续集成公司自研 Skill 时：

1. 将每个 Skill 以 `<skill-name>/SKILL.md` 形式放入相应场景的 `skills/` 目录。
2. 一个 Skill 需要被多个场景共用时，只保留一份实体目录，并在 `bundle.json` 的多个 `skillPaths` 中引用该目录。
3. 运行现有打包命令，Skill 会随安装包内置；无需修改业务代码。

打包前后都会调用安装包所使用的 Pi Skill 加载器，按场景分别检查 `skillPaths`，并遍历 Skill 的全部支撑文件。空目录可以保留；任何加载诊断（包括缺失/非法元数据）、同场景名称冲突、越出声明目录或符号链接/目录联接都会使打包失败。需要复用时请通过 `bundle.json` 声明同一实体路径，不要在 Skill 内创建文件系统链接。跨场景出现同名 Skill 不会互相冲突，因为各场景独立加载。

安装后的内置资源随程序目录分发，产品界面暂不提供编辑入口。用户手动安装的 Skill 仍按 Pi 原有规则加载。

## 场景 MCP

内置 MCP 与 `skills/` 同级放在 `scenes/<scene>/mcp/<integration-id>/`，每个集成目录必须包含 `integration.json`、`SHA256SUMS.json` 和清单声明的运行时。例如 BreakHub 的目录为：

```text
scenes/integration/
├─ skills/breakpoint-debugging/
└─ mcp/breakhub/
   ├─ integration.json
   ├─ SHA256SUMS.json
   └─ runtime/win-x64/breakhub-mcp.exe
```

场景通过 `bundle.json` 的 `mcpPaths` 声明 MCP 根目录。打包前后都会拒绝路径逃逸、文件系统链接、遗漏文件、SHA-256 不匹配、非法 PE 或目标架构不匹配；当前 BreakHub 只支持 Windows x64，因此不能生成包含它的 Windows arm64 安装包。

联调会话只保留一个 MCP Adapter：先读取用户与项目现有 MCP 配置，再以场景内置定义整项覆盖同名 `microbreakpoint` 服务。内存叠加会强制保留 `mcp` proxy，并禁止把 BreakHub 展开为 direct tools，使 `breakpoint-debugging` Skill 的调用方式不受 ambient 设置或 `MCP_DIRECT_TOOLS` 环境覆盖影响。它不会修改用户的 `mcp.json`，退出联调场景后也不会把 BreakHub 暴露给其他场景。如果全局或项目设置还声明了另一份 Adapter（包括直接扩展路径），联调场景会主动关闭并过滤它，改用内置版本；其他场景仍沿用原来的 Adapter 选择规则。

BreakHub 的环境隔离是服务器级规则，不会屏蔽同一 Adapter 中其他 ambient 服务的 direct-tools 选择。项目精确锁定 `pi-mcp-adapter` 版本；`npm install` 会幂等应用兼容补丁，`prepack` 和安装器构建会在补丁缺失或版本不匹配时失败。

场景 MCP 配置由程序只读注入，因此联调场景中的整个 Adapter 都处于 programmatic config 模式：不仅内置 BreakHub，合并进来的 ambient 服务也不能在该会话内通过配置向导或 enable/disable 操作持久修改。工具调用、状态查询和重连仍由同一个 Adapter 提供；需要改配置时应编辑原配置来源并重新加载会话。
