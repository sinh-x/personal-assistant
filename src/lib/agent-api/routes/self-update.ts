/**
 * Self-update route — trigger PA self-update (git pull + deploy).
 *
 * POST /api/self-update — fire-and-forget self-update trigger.
 *   Returns 202: {status: "building", startedAt: ISO8601} — update started
 *   Returns 409: {error: "Build already in progress", code: "CONFLICT"} — update already running
 *
 * GET /api/self-update/status — get current update state.
 *   Returns 200: {status, startedAt, completedAt, log: string[]} — status is idle|building|success|error
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { spawn } from "node:child_process";
import { loadRepoEntry } from "../../repos.js";

interface SelfUpdateState {
  status: "idle" | "building" | "success" | "error";
  startedAt: string | null;
  completedAt: string | null;
  logLines: string[];
}

// Module-level state — persists across requests
let state: SelfUpdateState = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  logLines: [],
};

const MAX_LOG_LINES = 200;

export function selfUpdateRoutes(): Hono {
  const app = new Hono();

  // POST /api/self-update — start self-update
  app.post("/api/self-update", async (c: Context) => {
    // Mutex check — only one update at a time
    if (state.status === "building") {
      return c.json({ error: "Build already in progress", code: "CONFLICT" }, 409);
    }

    // Resolve avodah repo path
    const avodahRepo = loadRepoEntry("avodah");
    if (!avodahRepo) {
      return c.json({ error: "Avodah repo not found in repos.yaml", code: "INTERNAL_ERROR" }, 500);
    }

    const avodahPath = avodahRepo.path;

    // Reset state for new build
    state = {
      status: "building",
      startedAt: new Date().toISOString(),
      completedAt: null,
      logLines: [],
    };

    const startedAt = state.startedAt;

    // Spawn detached child process: run bash tool/deploy.sh oppo
    // Use detached: true, stdio: 'pipe' so we can capture output, then unref
    const child = spawn("nix", ["develop", "--command", "bash", "-c", "bash tool/deploy.sh oppo"], {
      cwd: avodahPath,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Capture stdout and stderr into logLines (last 200 lines)
    const appendLog = (line: string) => {
      state.logLines.push(line);
      if (state.logLines.length > MAX_LOG_LINES) {
        state.logLines.shift();
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString("utf-8").split("\n");
      for (const line of lines) {
        if (line) appendLog(line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString("utf-8").split("\n");
      for (const line of lines) {
        if (line) appendLog(line);
      }
    });

    child.on("error", (err: Error) => {
      appendLog(`[ERROR] ${err.message}`);
      state.status = "error";
      state.completedAt = new Date().toISOString();
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        state.status = "success";
      } else {
        state.status = "error";
        appendLog(`[EXIT] Process exited with code ${code}`);
      }
      state.completedAt = new Date().toISOString();
    });

    // Brief wait to catch immediate spawn failures
    const spawnError = await new Promise<Error | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 50);
      child.once("error", (err: Error) => {
        clearTimeout(timer);
        resolve(err);
      });
    });

    if (spawnError !== null) {
      state.status = "error";
      state.completedAt = new Date().toISOString();
      appendLog(`[SPAWN_ERROR] ${spawnError.message}`);
      return c.json({ status: "building", startedAt }, 202);
    }

    // Let the detached process live independently of the API process
    child.unref();

    return c.json({ status: "building", startedAt }, 202);
  });

  // GET /api/self-update/status — get current state
  app.get("/api/self-update/status", (c: Context) => {
    // Return last 20 log lines
    const log = state.logLines.slice(-20);
    return c.json({
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      log,
    });
  });

  return app;
}
