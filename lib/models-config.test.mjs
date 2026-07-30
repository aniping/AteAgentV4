import assert from "node:assert/strict";
import test from "node:test";

import {
  filterModelsByConfig,
  isModelAllowedByConfig,
  normalizeModelsConfig,
  selectAvailableModel,
} from "./models-config.ts";

test("drops unfinished model drafts while preserving imported models", () => {
  const config = normalizeModelsConfig({
    providers: {
      deepseek: {
        models: [
          { id: "" },
          { id: "  " },
          { id: "deepseek-v4-pro" },
        ],
      },
    },
  });

  assert.deepEqual(config.providers?.deepseek.models, [{ id: "deepseek-v4-pro" }]);
});

test("preserves an explicit empty model list", () => {
  const config = normalizeModelsConfig({
    providers: {
      deepseek: { models: [{ id: "" }] },
    },
  });

  assert.deepEqual(config.providers?.deepseek.models, []);
});

test("treats configured models as the visible list for an overlaid builtin provider", () => {
  const available = [
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "deepseek", id: "deepseek-v4-pro" },
    { provider: "ollama", id: "deepseek-r1:8b" },
  ];
  const config = {
    providers: {
      deepseek: { models: [{ id: "deepseek-v4-pro" }] },
    },
  };

  assert.deepEqual(filterModelsByConfig(available, config), [
    { provider: "deepseek", id: "deepseek-v4-pro" },
    { provider: "ollama", id: "deepseek-r1:8b" },
  ]);
  assert.equal(isModelAllowedByConfig({ provider: "deepseek", id: "deepseek-v4-flash" }, config), false);
  assert.equal(isModelAllowedByConfig({ provider: "deepseek", id: "deepseek-v4-pro" }, config), true);
});

test("hides every model for a provider whose explicit model list is empty", () => {
  const available = [
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "ollama", id: "deepseek-r1:8b" },
  ];

  assert.deepEqual(filterModelsByConfig(available, {
    providers: { deepseek: { models: [] } },
  }), [
    { provider: "ollama", id: "deepseek-r1:8b" },
  ]);
});

test("moves a removed current model to the first available model", () => {
  const available = [
    { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { provider: "ollama", id: "deepseek-r1:8b", name: "DeepSeek R1" },
  ];

  assert.deepEqual(
    selectAvailableModel({ provider: "deepseek", modelId: "deepseek-v4-flash" }, available),
    { provider: "deepseek", modelId: "deepseek-v4-pro" },
  );
  assert.equal(
    selectAvailableModel({ provider: "deepseek", modelId: "deepseek-v4-pro" }, available),
    null,
  );
});
