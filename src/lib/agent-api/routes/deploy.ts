/**
 * Deploy route — trigger a PA team deployment.
 *
 * POST /api/deploy — fire-and-forget deployment trigger.
 *   Body: {team: string, mode?: string, objective?: string, repo?: string, ticket?: string}
 *   Returns: {deployment_id: string, status: "launched", team, mode}
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { spawn } from "node:child_process";
import { getBinDir } from "../../paths.js";
import { join } from "node:path";

/** Validate that a string only contains safe characters for CLI args */
function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function getPaBin(): string {
  return process.env["PA_BIN"] ?? join(getBinDir(), "pa");
}

export function deployRoutes(): Hono {
  const app = new Hono();

  // POST /api/deploy — fire-and-forget deployment
  app.post("/api/deploy", async (c: Context) => {
    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    const team = body["team"] as string | undefined;
    const mode = body["mode"] as string | undefined;
    const objective = body["objective"] as string | undefined;
    const repo = body["repo"] as string | undefined;
    const ticket = body["ticket"] as string | undefined;

    if (!team || !team.trim()) {
      return c.json({ error: "team is required", code: "BAD_REQUEST" }, 400);
    }
    if (!isSafeIdentifier(team)) {
      return c.json({ error: "Invalid team name", code: "BAD_REQUEST" }, 400);
    }
    if (repo && !isSafeIdentifier(repo)) {
      return c.json({ error: "Invalid repo name", code: "BAD_REQUEST" }, 400);
    }
    if (ticket && !/^[A-Z][A-Z0-9]+-[0-9]+$/.test(ticket)) {
      return c.json({ error: "Invalid ticket ID", code: "BAD_REQUEST" }, 400);
    }

    // Validate objective: max 500 chars, safe ASCII only
    if (objective && objective.trim()) {
      if (objective.length > 500) {
        return c.json({ error: "objective exceeds max length of 500 characters", code: "BAD_REQUEST" }, 400);
      }
      // Reject shell injection chars: backtick, $, \, ;, &, |, >, <
      if (/[\x00-\x1f\x7f`$\\;&|><]/.test(objective)) {
        return c.json({ error: "objective contains invalid characters", code: "BAD_REQUEST" }, 400);
      }
    }

    // Build pa command args
    // daily team: pa daily <mode>; others: pa deploy <team> --mode <mode> --background
    const args: string[] = [];
    if (team === "daily") {
      args.push("daily", mode ?? "plan");
    } else {
      args.push("deploy", team, "--background");
      if (mode) {
        args.push("--mode", mode);
      }
      if (repo) {
        args.push("--repo", repo);
      }
    }
    if (objective && objective.trim()) {
      args.push("--objective", objective.trim());
    }
    if (ticket && ticket.trim()) {
      args.push("--ticket", ticket.trim());
    }

    // Spawn and read first line for deployment ID (with 5s timeout)
    const paBin = getPaBin();
    let deploymentId = "";

    await new Promise<void>((resolve) => {
      const proc = spawn(paBin, args, {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });

      let partial = "";
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 5000);

      proc.stdout?.on("data", (chunk: Buffer) => {
        if (resolved) return;
        partial += chunk.toString();
        const nl = partial.indexOf("\n");
        if (nl >= 0) {
          const firstLine = partial.substring(0, nl);
          const match = firstLine.match(/\b(d-[a-f0-9]{6})\b/);
          if (match) deploymentId = match[1];
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      proc.on("error", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      proc.unref();
    });

    return c.json({
      deployment_id: deploymentId,
      status: "launched",
      team,
      mode: mode ?? null,
    });
  });

  return app;
}
