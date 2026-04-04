/**
 * Deployments routes — list deployments and activity from registry.jsonl.
 *
 * GET /api/deployments              — list deployments, grouped by ID, latest status
 * GET /api/deployments/:id/activity — full event timeline for a specific deployment
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getRegistryPath } from "../../paths.js";
import type { RegistryEvent, DeploymentStatus } from "../../types.js";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const DEPLOYMENTS_DIR = join(AI_USAGE, "deployments");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseRegistry(): RegistryEvent[] {
  const path = getRegistryPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RegistryEvent];
      } catch {
        return [];
      }
    });
}

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

export function deploymentsRoutes(): Hono {
  const app = new Hono();

  // GET /api/deployments — list all deployments, latest status per deployment
  app.get("/api/deployments", (c: Context) => {
    const sinceParam = c.req.query("since");
    const limitParam = c.req.query("limit");
    const allParam = c.req.query("all");

    // Validate since param if provided
    if (sinceParam && !isValidDateString(sinceParam)) {
      return c.json({ error: "Invalid 'since' parameter. Expected YYYY-MM-DD format.", code: "BAD_REQUEST" }, 400);
    }

    // Determine date filter
    let since: string | undefined;
    if (allParam === "true") {
      since = undefined; // bypass date filtering
    } else if (sinceParam) {
      since = sinceParam;
    } else {
      since = getTodayDateString();
    }

    // Parse limit (default 50, max 200)
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;

    const events = parseRegistry();
    let deployments = computeDeploymentStatuses(events);

    // Apply date filter if since is set
    if (since) {
      deployments = deployments.filter((d) => d.started_at >= since);
    }

    const total = deployments.length;
    const limited = deployments.slice(0, limit);

    return c.json({
      deployments: limited,
      total,
      filter: {
        since,
        limit,
        status: "all",
      },
    });
  });

  // GET /api/deployments/:id — single deployment detail (metadata + activity)
  app.get("/api/deployments/:id", (c: Context) => {
    const id = c.req.param("id");

    // Validate deployment id: alphanumeric + hyphens only
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return c.json({ error: "Invalid deployment id", code: "BAD_REQUEST" }, 400);
    }

    // Filter registry events for this deployment
    const events = parseRegistry().filter((e) => e.deployment_id === id);

    if (events.length === 0) {
      return c.json({ error: "Deployment not found", code: "NOT_FOUND" }, 404);
    }

    const started = events.find((e) => e.event === "started");
    const completed = events.find((e) => e.event === "completed");
    const crashed = events.find((e) => e.event === "crashed");
    const pidEv = events.find((e) => e.event === "pid");

    let status: DeploymentStatus["status"] = "unknown";
    if (completed) {
      status = (completed.status as DeploymentStatus["status"]) ?? "success";
    } else if (crashed) {
      status = "crashed";
    } else if (started) {
      status = "running";
    }

    // Check if primer.md exists in deployment workspace
    const primerWorkspacePath = join(DEPLOYMENTS_DIR, id, "primer.md");
    const primerPath = existsSync(primerWorkspacePath)
      ? `deployments/${id}/primer.md`
      : undefined;

    const deployment = {
      deploy_id: id,
      team: started?.team ?? events[0]?.team ?? "",
      status,
      started_at: started?.timestamp ?? events[0]?.timestamp ?? "",
      completed_at: completed?.timestamp ?? crashed?.timestamp,
      pid: pidEv?.pid,
      agents: started?.agents ?? [],
      models: started?.models,
      summary: completed?.summary,
      log_file: started?.log_file,
      primer: started?.primer,
      primer_path: primerPath,
      provider: started?.provider,
      error: completed?.error ?? crashed?.error,
      exit_code: completed?.exit_code ?? crashed?.exit_code,
      rating: completed?.rating,
      ticket_id: started?.ticket_id,
      objective: started?.objective,
      repo: started?.repo,
    };

    // Read activity.jsonl (no since filter)
    const activityPath = join(DEPLOYMENTS_DIR, id, "activity.jsonl");
    const activityEvents: Record<string, unknown>[] = [];
    if (existsSync(activityPath)) {
      for (const line of readFileSync(activityPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          activityEvents.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // skip malformed lines
        }
      }
    }

    return c.json({ deployment, activity_events: activityEvents });
  });

  // GET /api/deployments/:id/activity — full event timeline for one deployment
  app.get("/api/deployments/:id/activity", (c: Context) => {
    const id = c.req.param("id");

    // Validate deployment id: alphanumeric + hyphens only
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return c.json({ error: "Invalid deployment id", code: "BAD_REQUEST" }, 400);
    }

    // First check registry events for this deployment
    const events = parseRegistry().filter((e) => e.deployment_id === id);

    // Also check activity.jsonl in the deployment workspace
    const activityPath = join(DEPLOYMENTS_DIR, id, "activity.jsonl");
    const activityEvents: Record<string, unknown>[] = [];
    if (existsSync(activityPath)) {
      const sinceParam = c.req.query("since");
      for (const line of readFileSync(activityPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed) as Record<string, unknown>;
          if (sinceParam) {
            const ts = json["ts"] as string | undefined;
            if (!ts || ts <= sinceParam) continue;
          }
          activityEvents.push(json);
        } catch {
          // skip malformed lines
        }
      }
    }

    return c.json({ events, activity_events: activityEvents });
  });

  return app;
}
