/**
 * Repo deployments routes — deployments filtered by repo key.
 *
 * GET /api/repos/:key/deployments — deployments for a single repo, with optional status filtering
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { basename } from "node:path";
import { loadRepoEntry } from "../../../lib/repos.js";
import { isProcessAlive } from "../../../utils/process.js";
import { parseRegistry, computeDeploymentStatuses } from "./deployments.js";
import type { DeploymentStatus } from "../../../lib/types.js";

const TERMINAL_STATUSES = new Set(["success", "partial", "failed", "crashed", "dead"]);

export function repoDeploymentsRoutes(): Hono {
  const app = new Hono();

  // GET /api/repos/:key/deployments — deployments for a single repo
  app.get("/api/repos/:key/deployments", (c: Context) => {
    const key = c.req.param("key");

    // Validate key: alphanumeric + hyphens only (reject path traversal attempts)
    if (!key || !/^[a-zA-Z0-9-]+$/.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Load repo entry
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path, description, prefix } = repoEntry;

    // Parse registry and compute statuses
    const events = parseRegistry();
    const allDeployments = computeDeploymentStatuses(events);

    // Filter to deployments that belong to this repo
    // Match against both exact repo key and repo path basename (F10)
    const repoBasename = basename(path);
    const filtered = allDeployments.filter((d) => {
      if (!d.repo) return false;
      return d.repo === key || d.repo === repoBasename;
    });

    // Get status filter param
    const statusFilter = c.req.query("status") || "all";

    // F4: Apply liveness check to ALL deployments with status=running before filtering
    // This ensures dead PIDs are marked as dead regardless of the status filter
    const withLivenessCheck = filtered.map((d) => {
      if (d.status === "running" && d.pid && !isProcessAlive(d.pid)) {
        return { ...d, status: "dead" as const };
      }
      return d;
    });

    // Apply status filter
    let statusFiltered: DeploymentStatus[];
    if (statusFilter === "running") {
      statusFiltered = withLivenessCheck.filter((d) => d.status === "running");
    } else if (statusFilter === "finished") {
      statusFiltered = withLivenessCheck.filter((d) => TERMINAL_STATUSES.has(d.status));
    } else {
      // "all" — no status filter
      statusFiltered = withLivenessCheck;
    }

    // Get limit param (default 50, max 200)
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;

    // Apply limit
    const limited = statusFiltered.slice(0, limit);

    return c.json({
      repo: { key: name, path, description, prefix },
      deployments: limited,
      total: statusFiltered.length,
      filter: {
        status: statusFilter,
        limit,
      },
    });
  });

  return app;
}
