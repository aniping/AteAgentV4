import assert from "node:assert/strict";
import test from "node:test";

import {
  createPromptLocaleExtension,
  localizeSystemPrompt,
  normalizePromptLocale,
} from "./system-prompt.ts";

const sdkPrompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Inspect PI_* environment variables for current model and session details.
- Use read to examine files instead of cat or sed.
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: C:/agent/README.md
- Additional docs: C:/agent/docs
- Examples: C:/agent/examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="I:/project/AGENTS.md">
Keep the technical path .pi/settings.json unchanged.
- Be concise in your responses
</project_instructions>

</project_context>


The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>example</name>
    <description>Example skill</description>
    <location>I:/skills/example/SKILL.md</location>
  </skill>
</available_skills>
Current working directory: I:/project`;

test("rebrands the English SDK prompt without changing its language", () => {
  const prompt = localizeSystemPrompt(sdkPrompt, "en");

  assert.match(prompt, /^You are a general-purpose AI assistant operating inside ATE Agent/);
  assert.match(prompt, /ATE Agent documentation/);
  assert.doesNotMatch(prompt, /operating inside pi|Pi documentation|working on pi topics|read pi \.md files/);
  assert.match(prompt, /- read: Read file contents/);
  assert.match(prompt, /Keep the technical path \.pi\/settings\.json unchanged\./);
});

test("localizes SDK-owned prompt text to Chinese", () => {
  const prompt = localizeSystemPrompt(sdkPrompt, "zh-CN");

  assert.match(prompt, /^你是运行在 ATE Agent（装备智能体平台）/);
  assert.match(prompt, /通用智能助手/);
  assert.match(prompt, /分析问题、使用工具、读取和编辑文件以及执行任务/);
  assert.match(prompt, /可用工具：/);
  assert.match(prompt, /- read: 读取文件内容/);
  assert.match(prompt, /- bash: 执行 Bash 命令/);
  assert.match(prompt, /- 使用 read 检查文件/);
  assert.match(prompt, /ATE Agent 文档/);
  assert.match(prompt, /项目专用说明和规范：/);
  assert.match(prompt, /以下技能为特定任务提供专门说明。/);
  assert.match(prompt, /当前工作目录：I:\/project$/);
  assert.match(prompt, /Keep the technical path \.pi\/settings\.json unchanged\./);
  assert.match(prompt, /<project_instructions path="I:\/project\/AGENTS\.md">\nKeep the technical path \.pi\/settings\.json unchanged\.\n- Be concise in your responses/);
  assert.doesNotMatch(prompt, /operating inside pi|Pi documentation/);
});

test("leaves user-provided custom system prompts untouched", () => {
  const customPrompt = `You are a project-specific assistant.
Keep Pi as written by the project.

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.`;

  assert.equal(localizeSystemPrompt(customPrompt, "en"), customPrompt);
  assert.equal(localizeSystemPrompt(customPrompt, "zh-CN"), customPrompt);
});

test("normalizes unsupported prompt locales to English", () => {
  assert.equal(normalizePromptLocale("zh-CN"), "zh-CN");
  assert.equal(normalizePromptLocale("en"), "en");
  assert.equal(normalizePromptLocale("zh"), "en");
  assert.equal(normalizePromptLocale(undefined), "en");
});

test("can switch an already-localized prompt to the other language", () => {
  const chinesePrompt = localizeSystemPrompt(sdkPrompt, "zh-CN");
  const englishPrompt = localizeSystemPrompt(chinesePrompt, "en");

  assert.match(englishPrompt, /^You are a general-purpose AI assistant operating inside ATE Agent/);
  assert.match(englishPrompt, /Project-specific instructions and guidelines:/);
  assert.match(englishPrompt, /The following skills provide specialized instructions/);
  assert.match(englishPrompt, /Current working directory: I:\/project$/);

  assert.equal(localizeSystemPrompt(englishPrompt, "zh-CN"), chinesePrompt);
});

test("uses the latest locale for every agent turn", () => {
  const state = { current: "zh-CN", forceEmpty: false };
  const extension = createPromptLocaleExtension(state);
  let beforeAgentStart;
  const factory = typeof extension === "function" ? extension : extension.factory;

  factory({
    on(event, handler) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
  });

  assert.ok(beforeAgentStart);
  assert.match(beforeAgentStart({ systemPrompt: sdkPrompt }).systemPrompt, /^你是运行在 ATE Agent（装备智能体平台）/);

  state.current = "en";
  assert.match(beforeAgentStart({ systemPrompt: sdkPrompt }).systemPrompt, /^You are a general-purpose AI assistant operating inside ATE Agent/);

  state.forceEmpty = true;
  assert.equal(beforeAgentStart({ systemPrompt: sdkPrompt }).systemPrompt, "");
});
