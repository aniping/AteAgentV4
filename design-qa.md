# Skills 三页面设计验收

## 对照基线

- 视觉源：`C:\Users\Administrator\.codex\visualizations\2026\08\27\01a04326-c2e6-7020-8b94-227100198abe\skills-redesign-prototype`
- 原始批准截图：`screenshots\01-current-available.png`、`03-market-install.png`、`04-zip-risk.png`
- 同视口源截图：`screenshots\source-current-available-normalized.png`、`source-market-install-normalized.png`、`source-zip-risk-normalized.png`
- 实现截图：`screenshots\production-current-available.png`、`production-market-install.png`、`production-zip-risk.png`
- 并排证据：`screenshots\comparison-current-available-normalized.png`、`comparison-market-install-normalized.png`、`comparison-zip-risk-normalized.png`
- 响应式证据：`screenshots\production-mobile-680.png`
- 实现地址：`http://127.0.0.1:30141/`
- 桌面视口：1280 × 720 CSS px，`devicePixelRatio = 1`；源与实现截图均为 1280 × 720 px，无密度缩放。
- 窄屏视口：680 × 720 CSS px，截图为 680 × 720 px。
- 状态：中文、需求场景、当前项目已选择；分别对照“当前可用”、skills.sh 安装和 ZIP 风险确认。

## Findings

- 无剩余 P0、P1 或 P2 问题。
- `已安装` 改为 `管理` 是有意的产品修正：接口返回运行时去重后的有效 Skill，而不是完整安装库存；继续使用“已安装”会构成错误承诺。
- skills.sh 结果详情只展示服务实际返回的包名、仓库、安装量和链接。视觉稿中的版本、作者、验证状态没有可靠数据源，因此没有伪造。

## 完整视图对照

- 当前可用：弹窗尺寸、四段结构、左右栏比例、场景 Skill 高亮、空项目分组、所有项目分组、详情层级和底部摘要与视觉稿一致；生产数据数量与背景工作区按真实状态展示。
- skills.sh：保持左侧检索结果、右侧范围确认和底部安装动作的布局。真实搜索返回 50 项并可滚动，已选结果与安装位置同步更新。
- ZIP：保持左侧文件检查、右侧风险说明、作用域、信任确认和最终按钮的布局；展示内容来自真实预检响应，而不是视觉稿中的固定样例。

重要文字和控件在 1280 × 720 并排图中可清晰辨认，因此未另做裁剪图。ZIP 主操作另外做了命中测试，确保按钮不仅可见，而且没有被底部栏覆盖。

## 必查视觉面

- 字体与排版：沿用应用既有字体与 `--font-mono`；标题、正文、徽标、路径和小字号层级与视觉稿一致，长描述和路径可滚动或截断。
- 间距与布局：桌面弹窗实测为 860 × 560，位置 `(210, 80)`，与视觉稿完全一致；680 px 宽时弹窗为左右各 8 px，未出现横向溢出，底部“完成”保持可见。
- 色彩与 Token：全部使用现有主题变量；选中、成功、警告和风险状态在明暗主题变量体系内，没有新增孤立配色系统。
- 图片与资产：该界面没有视觉稿要求的插图、Logo 或非标准图标；关闭动作使用真实文字按钮，没有用手写 SVG、emoji 或占位图形替代资产。
- 文案与内容：明确解释“模型看到名称和描述后按意图加载，但并非每轮强制调用”，同时提供 `/skill:grill-me` 强制调用；项目与全局路径分别使用真实 `.pi/skills` 和 `~/.pi/agent/skills`。

## 比较与修正历史

1. 首轮发现 P2：ZIP 的“确认安装”按钮被弹窗底部栏覆盖。浏览器命中测试记录为按钮 `top=571.06`、`bottom=608.06`、底部栏 `top=583`，中心点命中底部栏而非按钮。
   - 修正：压缩 ZIP 详情描述、作用域卡片、信任卡片和操作区的垂直节奏。
   - 复验：按钮 `top=542.56`、`bottom=579.56`、底部栏 `top=583`，中心点命中按钮；最终证据见 `production-zip-risk.png`。
2. 第二轮发现 P2：“当前可用”遗漏空的当前项目分组，并把全局作用域简写为“全局”，弱化了来源范围。
   - 修正：固定展示“当前项目”空状态，并在此页面使用“所有项目”；管理页仍使用技术作用域“全局”。
   - 复验：最终 DOM 与并排截图同时显示“当前未加载项目级 Skill”和“所有项目”。
3. 交互检查发现 P2：市场搜索只有输入框，缺少明确提交动作。
   - 修正：加入可禁用、带加载状态的“搜索”按钮，同时保留 Enter 提交。
   - 复验：搜索 `pdf` 返回 50 项，首项详情、作用域和安装位置均正确更新。
4. 最终复验：新开干净页面后，场景 Skill、自动调用说明、手动命令和关闭按钮均可见；浏览器控制台无 error 或 warning。

## 主交互验证

- 三个一级页签点击切换；方向键可从“管理”切到“添加技能”。
- 管理页项目/全局/路径筛选生效，场景内置 Skill 不进入可管理库存。
- 打开弹窗后焦点落在当前页签；Escape 关闭后焦点回到“技能”入口。
- skills.sh 搜索返回真实结果，项目/全局单选会同步真实安装位置；未执行安装。
- ZIP 上传只执行预检：显示文件数、展开大小、SHA-256 和风险分类。确认前按钮禁用；勾选后启用；切换作用域会重新预检、清空确认并再次禁用。未执行最终安装。
- 680 × 720 响应式页面无横向溢出，持久操作可见。

## Implementation Checklist

- [x] 当前可用 / 管理 / 添加技能三页面落地
- [x] 场景内置 Skill 自动匹配解释与只读状态
- [x] skills.sh 搜索、选择、作用域与安装入口
- [x] ZIP 只读预检、摘要脱敏、哈希绑定与显式确认
- [x] 键盘、焦点、筛选、响应式和控制台检查
- [x] TypeScript、ESLint 与 756 项全量测试通过

## Follow-up Polish

- P3：若 skills.sh 后续提供可信的详情 API，可补充版本、发布者和签名状态；当前不应从包名推测。

final result: passed
