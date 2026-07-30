import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelsConfig } from "./models-config";

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

export function readModelsConfig(): ModelsConfig {
  const path = getModelsConfigPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ModelsConfig;
  } catch {
    return { providers: {} };
  }
}

export function writeModelsConfig(config: ModelsConfig): void {
  const path = getModelsConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
}
