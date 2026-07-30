export interface ModelConfigEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

export interface ProviderConfigEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelConfigEntry[];
  modelOverrides?: Record<string, unknown>;
}

export interface ModelsConfig {
  providers?: Record<string, ProviderConfigEntry>;
}

export interface ModelReference {
  provider: string;
  id: string;
}

export interface SelectedModelReference {
  provider: string;
  modelId: string;
}

export function normalizeModelsConfig(config: ModelsConfig): ModelsConfig {
  if (!config.providers) return config;

  const providers = Object.fromEntries(Object.entries(config.providers).map(([providerName, provider]) => {
    if (!provider.models) return [providerName, provider];
    const models = provider.models
      .filter((model) => model.id.trim().length > 0)
      .map((model) => ({ ...model, id: model.id.trim() }));
    return [providerName, { ...provider, models }];
  }));

  return { ...config, providers };
}

export function isModelAllowedByConfig(model: ModelReference, config: ModelsConfig): boolean {
  const configuredModels = config.providers?.[model.provider]?.models;
  if (configuredModels === undefined) return true;
  return configuredModels.some((configured) => configured.id === model.id);
}

export function filterModelsByConfig<T extends ModelReference>(available: readonly T[], config: ModelsConfig): T[] {
  return available.filter((model) => isModelAllowedByConfig(model, config));
}

export function selectAvailableModel<T extends ModelReference>(
  current: SelectedModelReference | null,
  available: readonly T[],
): SelectedModelReference | null {
  if (!current || available.some((model) => model.provider === current.provider && model.id === current.modelId)) {
    return null;
  }
  const fallback = available[0];
  return fallback ? { provider: fallback.provider, modelId: fallback.id } : null;
}
