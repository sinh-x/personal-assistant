import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { getRegistryPath, getRegistryLockPath } from "./paths.js";
import type { RegistryEvent } from "./types.js";

/**
 * Read all events from the registry JSONL file.
 */
export function readRegistry(): RegistryEvent[] {
  const path = getRegistryPath();
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RegistryEvent);
}

/**
 * Append an event to the registry JSONL with flock.
 * Uses the same locking mechanism as the bash scripts.
 */
export function appendRegistryEvent(event: RegistryEvent): void {
  const registryPath = getRegistryPath();
  const lockPath = getRegistryLockPath();
  const json = JSON.stringify(event);

  // Use flock for atomic append, matching bash behavior
  execSync(
    `flock -w 5 "${lockPath}" bash -c 'echo ${JSON.stringify(json)} >> "${registryPath}"'`
  );
}

/**
 * Get events for a specific deployment ID.
 */
export function getDeploymentEvents(deployId: string): RegistryEvent[] {
  return readRegistry().filter((e) => e.deployment_id === deployId);
}

/**
 * Get the latest event for each deployment, grouped by deploy_id.
 */
export function getLatestDeployments(): Map<string, RegistryEvent[]> {
  const events = readRegistry();
  const grouped = new Map<string, RegistryEvent[]>();

  for (const event of events) {
    const existing = grouped.get(event.deployment_id) ?? [];
    existing.push(event);
    grouped.set(event.deployment_id, existing);
  }

  return grouped;
}
