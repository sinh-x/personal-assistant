import { resolve } from "node:path";
import { homedir } from "node:os";

/** Resolve ~ to actual home directory */
function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

/**
 * PA_HOME — read-only install directory containing teams/, skills/, docs.
 * Set by Nix wrapper or defaults to the project root during development.
 */
export function getHomeDir(): string {
  return process.env["PA_HOME"] ?? resolve(import.meta.dirname, "../..");
}

/**
 * PA_DATA — mutable data directory for primers, logs.
 * Defaults to ~/.local/share/personal-assistant
 */
export function getDataDir(): string {
  return (
    process.env["PA_DATA"] ??
    resolve(homedir(), ".local/share/personal-assistant")
  );
}

/**
 * PA_CONFIG — user config override directory (teams/, skills/).
 * Read from ~/.config/sinh-x/personal-assistant/config.yaml
 */
export function getConfigDir(): string | undefined {
  return process.env["PA_CONFIG"] || undefined;
}

/**
 * PA_BIN — directory containing wrapped binaries.
 * Set by Nix wrapper.
 */
export function getBinDir(): string {
  return process.env["PA_BIN"] ?? resolve(getHomeDir(), "../bin");
}

/** Path to the user config YAML file */
export function getUserConfigPath(): string {
  return resolve(homedir(), ".config/sinh-x/personal-assistant/config.yaml");
}

/** Deployment registry JSONL file */
export function getRegistryPath(): string {
  return expandHome("~/Documents/ai-usage/deployments/registry.jsonl");
}

/** Registry lock file */
export function getRegistryLockPath(): string {
  return expandHome("~/Documents/ai-usage/deployments/.registry.lock");
}

/** Teams directory — config override or PA_HOME fallback */
export function getTeamsDir(): string {
  const configDir = getConfigDir();
  return configDir ? resolve(configDir, "teams") : resolve(getHomeDir(), "teams");
}

/** Built-in teams directory (from PA_HOME) */
export function getBuiltinTeamsDir(): string {
  return resolve(getHomeDir(), "teams");
}

/** Primers directory */
export function getPrimersDir(): string {
  return resolve(getDataDir(), "primers");
}

/** Logs directory */
export function getLogsDir(): string {
  return resolve(getDataDir(), "logs");
}

/** Agent teams persistent workspace directory */
export function getAgentTeamsDir(): string {
  return expandHome("~/Documents/ai-usage/agent-teams");
}
