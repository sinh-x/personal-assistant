/**
 * Deploy route — trigger a PA team deployment.
 *
 * POST /api/deploy — fire-and-forget deployment trigger.
 *   Body: {team: string, mode?: string, objective?: string, repo?: string, ticket?: string}
 *   Returns 202: {status: "pending", team, mode} — spawned successfully; real status arrives via WS deployment-status-change
 *   Returns 202: {status: "failed", reason: string} — spawn failed (binary not found, permission error, etc.)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { spawn } from "node:child_process";
import { getBinDir } from "../../paths.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

/** Validate that a string only contains safe characters for CLI args */
function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function getPaBin(): string {
  if (process.env["PA_BIN"]) return process.env["PA_BIN"];
  const resolved = join(getBinDir(), "pa");
  if (existsSync(resolved)) return resolved;
  return "pa"; // fall back to PATH lookup
}

export function deployRoutes(): Hono {
  const app = new Hono();

  // POST /api/deploy — fire-and-forget deployment
  app.post("/api/deploy", async (c: Context) => {
    let body: Record<string, unknown>;
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
    const provider = body["provider"] as string | undefined;
    const teamModel = body["team_model"] as string | undefined;

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
    if (provider && !isSafeIdentifier(provider)) {
      return c.json({ error: "Invalid provider", code: "BAD_REQUEST" }, 400);
    }
    if (teamModel && !isSafeIdentifier(teamModel)) {
      return c.json({ error: "Invalid model", code: "BAD_REQUEST" }, 400);
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
    if (provider && provider.trim()) {
      args.push("--provider", provider.trim());
    }
    if (teamModel && teamModel.trim()) {
      args.push("--model", teamModel.trim());
    }

    // Spawn detached and return 202 immediately — phone gets real status via WS deployment-status-change
    const paBin = getPaBin();
    let proc: ReturnType<typeof spawn>;

    try {
      proc = spawn(paBin, args, { detached: true, stdio: "ignore" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return c.json({ status: "failed", reason, team, mode: mode ?? null }, 202);
    }

    // Brief wait (50ms) to catch immediate spawn failures (e.g., binary not found)
    const spawnError = await new Promise<Error | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 50);
      proc.once("error", (err: Error) => {
        clearTimeout(timer);
        resolve(err);
      });
    });

    if (spawnError !== null) {
      return c.json({ status: "failed", reason: spawnError.message, team, mode: mode ?? null }, 202);
    }

    proc.on("error", () => {}); // Suppress late errors after response is sent
    proc.unref();

    return c.json({ status: "pending", team, mode: mode ?? null }, 202);
  });

  return app;
}
