# Wireless ATE Agent 内置资源

此目录是安装包内置 Agent 与 Skill 的唯一资源入口。`bundle.json` 定义五个场景及其资源路径；打包脚本会校验并完整复制本目录。

后续集成公司自研 Skill 时：

1. 将每个 Skill 以 `<skill-name>/SKILL.md` 形式放入相应场景的 `skills/` 目录。
2. 一个 Skill 需要被多个场景共用时，只保留一份实体目录，并在 `bundle.json` 的多个 `skillPaths` 中引用该目录。
3. 运行现有打包命令，Skill 会随安装包内置；无需修改业务代码。

安装后的内置资源随程序目录分发，产品界面暂不提供编辑入口。用户手动安装的 Skill 仍按 Pi 原有规则加载。
