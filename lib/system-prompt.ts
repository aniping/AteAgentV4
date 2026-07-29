import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type PromptLocale = "en" | "zh-CN";

export interface PromptLocaleState {
  current: PromptLocale;
  forceEmpty: boolean;
}

const SDK_HEADER = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const SDK_DOCS_END = "- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)";
const EN_HEADER = "You are a general-purpose AI assistant operating inside ATE Agent, an equipment agent platform. You help users by analyzing problems, using tools, reading and editing files, and completing tasks.";
const ZH_HEADER = "你是运行在 ATE Agent（装备智能体平台）中的通用智能助手。你通过分析问题、使用工具、读取和编辑文件以及执行任务来帮助用户。";
const EN_DOCS_END = "- Always read ATE Agent .md files completely and follow links to related docs (e.g., tui.md for TUI API details)";
const ZH_DOCS_END = "- 始终完整阅读 ATE Agent 的 .md 文件，并继续查看其中链接的相关文档（例如阅读 tui.md 获取 TUI API 详情）";

const EN_BRAND_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [SDK_HEADER, EN_HEADER],
  ["Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):", "ATE Agent documentation (read only when the user asks about ATE Agent itself, its SDK, extensions, themes, skills, or TUI):"],
  ["- When reading pi docs or examples,", "- When reading ATE Agent docs or examples,"],
  ["pi packages (docs/packages.md)", "ATE Agent packages (docs/packages.md)"],
  ["- When working on pi topics,", "- When working on ATE Agent topics,"],
  ["- Always read pi .md files completely", "- Always read ATE Agent .md files completely"],
];

const ZH_OWNED_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [SDK_HEADER, ZH_HEADER],
  ["Available tools:", "可用工具："],
  ["- read: Read file contents", "- read: 读取文件内容"],
  ["- bash: Execute bash commands (ls, grep, find, etc.)", "- bash: 执行 Bash 命令（ls、grep、find 等）"],
  ["- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call", "- edit: 使用精确文本替换修改文件，单次调用可包含多处互不重叠的编辑"],
  ["- write: Create or overwrite files", "- write: 创建或覆盖文件"],
  ["- grep: Search file contents for patterns (respects .gitignore)", "- grep: 按模式搜索文件内容（遵循 .gitignore）"],
  ["- find: Find files by glob pattern (respects .gitignore)", "- find: 按 glob 模式查找文件（遵循 .gitignore）"],
  ["- ls: List directory contents", "- ls: 列出目录内容"],
  ["In addition to the tools above, you may have access to other custom tools depending on the project.", "除上述工具外，你还可能根据项目获得其他自定义工具。"],
  ["Guidelines:", "工作规范："],
  ["- Use bash for file operations like ls, rg, find", "- 使用 bash 执行 ls、rg、find 等文件操作"],
  ["- Inspect PI_* environment variables for current model and session details.", "- 检查 PI_* 环境变量以了解当前模型和会话信息。"],
  ["- Use read to examine files instead of cat or sed.", "- 使用 read 检查文件，不要使用 cat 或 sed。"],
  ["- Use edit for precise changes (edits[].oldText must match exactly)", "- 使用 edit 进行精确修改（edits[].oldText 必须完全匹配）"],
  ["- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls", "- 修改同一文件中的多个独立位置时，在一次 edit 调用的 edits[] 中提供多个条目，不要发起多次 edit 调用"],
  ["- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.", "- 每个 edits[].oldText 都与原始文件匹配，而不是与前一项编辑后的结果匹配。不要提交重叠或嵌套的编辑；相邻修改应合并为一项。"],
  ["- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.", "- 在保证 edits[].oldText 在文件中唯一的前提下尽量缩小其范围，不要填充大段未修改内容。"],
  ["- Use write only for new files or complete rewrites.", "- 仅在创建新文件或完整重写文件时使用 write。"],
  ["- Be concise in your responses", "- 回复应简洁"],
  ["- Show file paths clearly when working with files", "- 处理文件时应清楚标明文件路径"],
  ["Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):", "ATE Agent 文档（仅当用户询问 ATE Agent 本身、SDK、扩展、主题、技能或 TUI 时读取）："],
  ["- Main documentation: ", "- 主文档："],
  ["- Additional docs: ", "- 补充文档："],
  ["- Examples: ", "- 示例："],
  [" (extensions, custom tools, SDK)", "（扩展、自定义工具、SDK）"],
  ["- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory", "- 阅读 ATE Agent 文档或示例时，应分别在“补充文档”和“示例”目录下解析 docs/... 与 examples/...，不要相对于当前工作目录解析"],
  ["- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)", "- 相关主题对应文档：扩展（docs/extensions.md、examples/extensions/）、主题（docs/themes.md）、技能（docs/skills.md）、提示词模板（docs/prompt-templates.md）、TUI 组件（docs/tui.md）、快捷键（docs/keybindings.md）、SDK 集成（docs/sdk.md）、自定义提供商（docs/custom-provider.md）、添加模型（docs/models.md）、ATE Agent 包（docs/packages.md）、环境变量（docs/environment-variables.md）"],
  ["- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing", "- 处理 ATE Agent 相关任务时，先阅读文档和示例，并在实现前继续阅读 .md 中交叉引用的相关资料"],
  ["- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)", "- 始终完整阅读 ATE Agent 的 .md 文件，并继续查看其中链接的相关文档（例如阅读 tui.md 获取 TUI API 详情）"],
];

const PROJECT_CONTEXT_SOURCE = "Project-specific instructions and guidelines:";
const SKILLS_SOURCE = `The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.`;
const PROJECT_CONTEXT_ZH = "项目专用说明和规范：";
const SKILLS_ZH = `以下技能为特定任务提供专门说明。
当任务与某项技能的描述匹配时，使用 read 工具加载该技能文件。
技能文件引用相对路径时，应相对于技能目录（SKILL.md 的父目录或该路径的 dirname）解析，并在工具命令中使用绝对路径。`;
const PROJECT_CONTEXT_SOURCE_BLOCK = `<project_context>\n\n${PROJECT_CONTEXT_SOURCE}\n\n<project_instructions`;
const PROJECT_CONTEXT_ZH_BLOCK = `<project_context>\n\n${PROJECT_CONTEXT_ZH}\n\n<project_instructions`;
const SKILLS_SOURCE_BLOCK = `${SKILLS_SOURCE}\n\n<available_skills>`;
const SKILLS_ZH_BLOCK = `${SKILLS_ZH}\n\n<available_skills>`;

export function normalizePromptLocale(value: unknown): PromptLocale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function replaceAllKnown(text: string, replacements: ReadonlyArray<readonly [string, string]>): string {
  let result = text;
  for (const [source, replacement] of replacements) {
    result = result.replaceAll(source, replacement);
  }
  return result;
}

function replaceLast(text: string, source: string, replacement: string): string {
  const index = text.lastIndexOf(source);
  if (index === -1) return text;
  return text.slice(0, index) + replacement + text.slice(index + source.length);
}

function restoreSdkOwnedPrompt(
  prompt: string,
  header: string,
  docsEndMarker: string,
  replacements: ReadonlyArray<readonly [string, string]>,
): string {
  if (!prompt.startsWith(header)) return prompt;
  const docsEnd = prompt.indexOf(docsEndMarker);
  const ownedEnd = docsEnd === -1 ? header.length : docsEnd + docsEndMarker.length;
  const ownedPrompt = prompt.slice(0, ownedEnd);
  const remainingPrompt = prompt.slice(ownedEnd);
  const reverseReplacements = replacements.map(
    ([source, localized]) => [localized, source] as const,
  );
  return replaceAllKnown(ownedPrompt, reverseReplacements) + remainingPrompt;
}

/**
 * Localizes only the SDK-owned default prompt text. Project instructions,
 * custom system prompts, extension text, paths, and compatibility identifiers
 * such as `.pi` and `PI_*` remain unchanged.
 */
export function localizeSystemPrompt(prompt: string, locale: PromptLocale): string {
  let result = restoreSdkOwnedPrompt(prompt, EN_HEADER, EN_DOCS_END, EN_BRAND_REPLACEMENTS);
  result = restoreSdkOwnedPrompt(result, ZH_HEADER, ZH_DOCS_END, ZH_OWNED_REPLACEMENTS);

  if (result.startsWith(SDK_HEADER)) {
    const docsEnd = result.indexOf(SDK_DOCS_END);
    const ownedEnd = docsEnd === -1 ? SDK_HEADER.length : docsEnd + SDK_DOCS_END.length;
    const ownedPrompt = result.slice(0, ownedEnd);
    const remainingPrompt = result.slice(ownedEnd);
    const replacements = locale === "zh-CN" ? ZH_OWNED_REPLACEMENTS : EN_BRAND_REPLACEMENTS;
    result = replaceAllKnown(ownedPrompt, replacements) + remainingPrompt;
  }

  if (locale === "zh-CN") {
    result = replaceLast(result, PROJECT_CONTEXT_SOURCE_BLOCK, PROJECT_CONTEXT_ZH_BLOCK);
    result = replaceLast(result, SKILLS_SOURCE_BLOCK, SKILLS_ZH_BLOCK);
    result = replaceLast(result, "\nCurrent working directory: ", "\n当前工作目录：");
  } else {
    result = replaceLast(result, PROJECT_CONTEXT_ZH_BLOCK, PROJECT_CONTEXT_SOURCE_BLOCK);
    result = replaceLast(result, SKILLS_ZH_BLOCK, SKILLS_SOURCE_BLOCK);
    result = replaceLast(result, "\n当前工作目录：", "\nCurrent working directory: ");
  }

  return result;
}

export function createPromptLocaleExtension(state: PromptLocaleState): InlineExtension {
  return {
    name: "ate-agent-prompt-locale",
    factory: (api) => {
      api.on("before_agent_start", (event) => {
        if (state.forceEmpty) return { systemPrompt: "" };
        const systemPrompt = localizeSystemPrompt(event.systemPrompt, state.current);
        return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
      });
    },
  };
}
