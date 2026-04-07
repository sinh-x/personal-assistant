import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { getRegistryPath, getRegistryLockPath } from "./paths.js";
import type { RegistryEvent, DeploymentStatus } from "./types.js";

/**
 * Validate a registry event has required fields.
 * Throws if required fields are missing.
 */
export function validateRegistryEvent(event: RegistryEvent): void {
  if (!event.deployment_id) {
    throw new Error("Registry event missing required field: deployment_id");
  }
  if (!event.team) {
    throw new Error("Registry event missing required field: team");
  }
  if (!event.event) {
    throw new Error("Registry event missing required field: event");
  }
  if (!event.timestamp) {
    throw new Error("Registry event missing required field: timestamp");
  }
}

// Singleton mtime cache for readRegistry()
let _cache: { events: RegistryEvent[]; mtime: number } | null = null;

/**
 * Read all events from the registry JSONL file.
 * Uses an in-memory mtime cache — returns cached events if the file hasn't changed.
 */
export function readRegistry(): RegistryEvent[] {
  const path = getRegistryPath();
  if (!existsSync(path)) {
    _cache = null;
    return [];
  }

  const mtime = statSync(path).mtimeMs;
  if (_cache && _cache.mtime === mtime) {
    return _cache.events;
  }

  const events: RegistryEvent[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RegistryEvent);
    } catch {
      // Malformed line — skip silently (e.g. concatenated JSON objects)
    }
  }
  _cache = { events, mtime };
  return events;
}

/**
 * Append an event to the registry JSONL with flock.
 * Uses the same locking mechanism as the bash scripts.
 * Validates the event before appending.
 */
export function appendRegistryEvent(event: RegistryEvent): void {
  validateRegistryEvent(event);
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

/**
 * Compute deployment statuses from a list of registry events.
 * Returns the computed status for each unique deployment.
 */
export function computeDeploymentStatuses(events: RegistryEvent[]): DeploymentStatus[] {
  const grouped = new Map<string, RegistryEvent[]>();
  for (const ev of events) {
    const existing = grouped.get(ev.deployment_id) ?? [];
    existing.push(ev);
    grouped.set(ev.deployment_id, existing);
  }

  const statuses: DeploymentStatus[] = [];
  for (const [deployId, evs] of grouped) {
    const started = evs.find((e) => e.event === "started");
    const completed = evs.find((e) => e.event === "completed");
    const crashed = evs.find((e) => e.event === "crashed");
    const pidEv = evs.find((e) => e.event === "pid");

    let status: DeploymentStatus["status"] = "unknown";
    if (completed) {
      status = (completed.status as DeploymentStatus["status"]) ?? "success";
    } else if (crashed) {
      status = "crashed";
    } else if (started) {
      status = "running";
    }

    statuses.push({
      deploy_id: deployId,
      team: started?.team ?? evs[0]?.team ?? "",
      status,
      started_at: started?.timestamp ?? evs[0]?.timestamp ?? "",
      completed_at: completed?.timestamp ?? crashed?.timestamp,
      pid: pidEv?.pid,
      agents: started?.agents ?? [],
      summary: completed?.summary,
      log_file: started?.log_file,
      primer: started?.primer,
      ticket_id: started?.ticket_id,
      objective: started?.objective,
      models: started?.models,
      provider: started?.provider,
      repo: started?.repo,
    });
  }

  // Sort by started_at descending (newest first)
  statuses.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return statuses;
}
