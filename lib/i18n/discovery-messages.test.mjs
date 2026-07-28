import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { enLocale } = await jiti.import("./messages/en.ts");
const { zhCNLocale } = await jiti.import("./messages/zh-CN.ts");

test("provides a fully localized skill catalog prompt", () => {
  assert.equal(enLocale.messages["i18n.skillCatalogBefore"], "Search ");
  assert.equal(enLocale.messages["i18n.skillCatalogAfter"], " to discover and install skills for your agent.");
  assert.equal(zhCNLocale.messages["i18n.skillCatalogBefore"], "访问 ");
  assert.equal(zhCNLocale.messages["i18n.skillCatalogAfter"], "，发现并安装适用于你的 Agent 的技能。");
});

test("provides a fully localized plugin installation prompt", () => {
  assert.equal(enLocale.messages["i18n.pluginSource"], "Source");
  assert.equal(enLocale.messages["i18n.examples"], "Examples");
  assert.equal(enLocale.messages["i18n.pluginCatalogBefore"], "Browse ");
  assert.equal(enLocale.messages["i18n.pluginCatalogAfter"], " to discover and install Pi plugins for your agent.");
  assert.equal(zhCNLocale.messages["i18n.pluginSource"], "来源");
  assert.equal(zhCNLocale.messages["i18n.examples"], "示例");
  assert.equal(zhCNLocale.messages["i18n.pluginCatalogBefore"], "访问 ");
  assert.equal(zhCNLocale.messages["i18n.pluginCatalogAfter"], "，发现并安装适用于你的 Agent 的 Pi 插件。");
});
