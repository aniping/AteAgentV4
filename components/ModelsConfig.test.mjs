import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  AddProviderPicker,
  INTERNAL_PROVIDER_CONFIG,
  INTERNAL_PROVIDER_NAME,
} = await jiti.import("./ModelsConfig.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("internal provider uses the AteTest defaults", () => {
  assert.equal(INTERNAL_PROVIDER_NAME, "AteTest");
  assert.deepEqual(INTERNAL_PROVIDER_CONFIG, {
    baseUrl: "http://ate-agent.rnd.huawei.com/v1",
    api: "openai-completions",
  });
});

test("provider picker shows internal and custom providers but hides managed options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(AddProviderPicker, {
        oauthProviders: [
          { id: "anthropic", name: "Claude subscription", usesCallbackServer: true, loggedIn: false },
        ],
        apiKeyProviders: [
          { id: "deepseek", displayName: "DeepSeek", configured: false, modelCount: 4 },
        ],
        onSelectOAuth() {},
        onSelectApiKey() {},
        onAddInternal() {},
        onAddCustom() {},
        onClose() {},
      }),
    ),
  );

  assert.match(html, /Internal models/);
  assert.match(html, /AteTest/);
  assert.match(html, /aria-label="HUMEP"/);
  assert.match(html, /Custom endpoint format/);
  assert.doesNotMatch(html, /Subscriptions|API Key|Claude subscription|DeepSeek/);
});
