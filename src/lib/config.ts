import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getUserConfigPath, getHomeDir, getDataDir } from "./paths.js";
import type { PAConfig } from "./types.js";

/** Simple YAML key extractor for the flat config file */
function extractYamlValue(content: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = content.match(re);
  if (!match) return undefined;
  let val = match[1].trim();
  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  // Expand ~
  if (val.startsWith("~")) {
    val = resolve(homedir(), val.slice(2));
  }
  return val;
}

/**
 * Load PA configuration from user config file and environment.
 * Mirrors the logic in pa-config.sh.
 */
export function loadConfig(): PAConfig {
  const configPath = getUserConfigPath();
  let configDir: string | undefined;
  let dataDir: string | undefined;

  let minimaxApiKey: string | undefined;

  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    configDir = extractYamlValue(content, "config_dir");
    dataDir = extractYamlValue(content, "data_dir");
    minimaxApiKey = extractYamlValue(content, "minimax_api_key");
  }

  // Environment variables override config file
  configDir = process.env["PA_CONFIG"] || configDir || "";
  dataDir = process.env["PA_DATA"] || dataDir || getDataDir();

  return {
    configDir,
    dataDir,
    homeDir: getHomeDir(),
    binDir: process.env["PA_BIN"] || resolve(getHomeDir(), "../bin"),
    minimax_api_key: minimaxApiKey,
  };
}
