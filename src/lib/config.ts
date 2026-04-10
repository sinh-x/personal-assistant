import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getUserConfigPath, getHomeDir, getDataDir } from "./paths.js";
import type { PAConfig, ProviderDefaults } from "./types.js";

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
 * Extract a nested YAML key like "providers.minimax.models.sonnet".
 * Handles indentation-aware YAML parsing for nested structures.
 */
function extractNestedYamlValue(content: string, keyPath: string): string | undefined {
  const segments = keyPath.split(".");
  // Find the top-level key
  const topKey = segments[0];
  const re = new RegExp(`^${topKey}:\\s*(.+)?$`, "m");
  const match = content.match(re);
  if (!match) return undefined;

  // If no nested path, return the simple value
  if (segments.length === 1) {
    if (!match[1]) return undefined;
    let val = match[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }

  // For nested keys, find the block content under this key
  const blockStart = content.indexOf(match[0]);
  const afterMatch = content.slice(blockStart + match[0].length);
  // Find the next top-level key (at same or less indentation)
  const nextKeyMatch = afterMatch.match(/^[^ ]/m);
  const blockEnd = nextKeyMatch ? blockStart + match[0].length + nextKeyMatch.index! : content.length;
  const blockContent = afterMatch.slice(0, blockEnd - blockStart - match[0].length);

  // Navigate nested segments
  let current = blockContent;
  for (let i = 1; i < segments.length - 1; i++) {
    const segment = segments[i];
    const segmentRe = new RegExp(`^${segment}:\\s*(.+)?$`, "m");
    const segmentMatch = current.match(segmentRe);
    if (!segmentMatch || !segmentMatch[1]) return undefined;
    const segStart = current.indexOf(segmentMatch[0]);
    const afterSeg = current.slice(segStart + segmentMatch[0].length);
    const nextSegMatch = afterSeg.match(/^[^ ]/m);
    const segEnd = nextSegMatch ? segStart + segmentMatch[0].length + nextSegMatch.index! : current.length;
    current = afterSeg.slice(0, segEnd - segStart - segmentMatch[0].length);
  }

  // Get the final value
  const finalSegment = segments[segments.length - 1];
  const finalRe = new RegExp(`^${finalSegment}:\\s*(.+)$`, "m");
  const finalMatch = current.match(finalRe);
  if (!finalMatch) return undefined;
  let val = finalMatch[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
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
  let providerDefaults: ProviderDefaults | undefined;

  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    configDir = extractYamlValue(content, "config_dir");
    dataDir = extractYamlValue(content, "data_dir");
    minimaxApiKey = extractYamlValue(content, "minimax_api_key");

    // Extract provider defaults if present
    const defaultProvider = extractNestedYamlValue(content, "default_provider");
    const defaultModel = extractNestedYamlValue(content, "default_model");
    const anthropicBaseUrl = extractNestedYamlValue(content, "providers.anthropic.base_url");
    const minimaxBaseUrl = extractNestedYamlValue(content, "providers.minimax.base_url");
    const anthropicSonner = extractNestedYamlValue(content, "providers.anthropic.models.sonnet");
    const anthropicOpus = extractNestedYamlValue(content, "providers.anthropic.models.opus");
    const anthropicHaiku = extractNestedYamlValue(content, "providers.anthropic.models.haiku");
    const minimaxSonner = extractNestedYamlValue(content, "providers.minimax.models.sonnet");
    const minimaxOpus = extractNestedYamlValue(content, "providers.minimax.models.opus");
    const minimaxHaiku = extractNestedYamlValue(content, "providers.minimax.models.haiku");

    // Only construct provider_defaults if something was found
    if (defaultProvider || defaultModel || anthropicBaseUrl || minimaxBaseUrl ||
        anthropicSonner || anthropicOpus || anthropicHaiku ||
        minimaxSonner || minimaxOpus || minimaxHaiku) {
      providerDefaults = {};
      if (defaultProvider) providerDefaults.default_provider = defaultProvider as "anthropic" | "minimax";
      if (defaultModel) providerDefaults.default_model = defaultModel as "haiku" | "sonnet" | "opus";
      if (anthropicBaseUrl || anthropicSonner || anthropicOpus || anthropicHaiku) {
        providerDefaults.providers = providerDefaults.providers || {};
        providerDefaults.providers.anthropic = {};
        if (anthropicBaseUrl) providerDefaults.providers.anthropic.base_url = anthropicBaseUrl;
        if (anthropicSonner) providerDefaults.providers.anthropic.models = { sonnet: anthropicSonner };
        if (anthropicOpus) providerDefaults.providers.anthropic.models!.opus = anthropicOpus;
        if (anthropicHaiku) providerDefaults.providers.anthropic.models!.haiku = anthropicHaiku;
      }
      if (minimaxBaseUrl || minimaxSonner || minimaxOpus || minimaxHaiku) {
        providerDefaults.providers = providerDefaults.providers || {};
        providerDefaults.providers.minimax = {};
        if (minimaxBaseUrl) providerDefaults.providers.minimax.base_url = minimaxBaseUrl;
        if (minimaxSonner) providerDefaults.providers.minimax.models = { sonnet: minimaxSonner };
        if (minimaxOpus) providerDefaults.providers.minimax.models!.opus = minimaxOpus;
        if (minimaxHaiku) providerDefaults.providers.minimax.models!.haiku = minimaxHaiku;
      }
    }
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
    provider_defaults: providerDefaults,
  };
}
