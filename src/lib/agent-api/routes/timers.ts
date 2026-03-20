/**
 * Timers route — list active systemd user timers.
 *
 * GET /api/timers — shell out to systemctl --user list-timers --no-pager
 *   Returns: {timers: [{unit, team, next_in}], raw: string}
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { execSync } from "node:child_process";

interface TimerEntry {
  unit: string;
  team: string;
  next_in: string;
}

/**
 * Parse systemctl list-timers output.
 *
 * Output format:
 *   NEXT                        LEFT  LAST  PASSED  UNIT                ACTIVATES
 *   Mon 2026-03-16 05:00:00 +07  6h  Sun ... -  pa-daily-plan.timer  ...
 */
function parseTimersOutput(output: string): TimerEntry[] {
  const timers: TimerEntry[] = [];
  const lines = output.split("\n").slice(1); // skip header line

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const timerIdx = parts.findIndex((p) => p.endsWith(".timer"));
    if (timerIdx < 0) continue;

    const unit = parts[timerIdx];
    // LEFT is at index 4 (after DAY DATE TIME ZONE)
    const left = parts.length > 4 ? parts[4] : "";
    // Strip "pa-" prefix and ".timer" suffix for readable team name
    const team = unit.replace(/^pa-/, "").replace(/\.timer$/, "");

    timers.push({ unit, team, next_in: left });
  }

  return timers;
}

export function timersRoutes(): Hono {
  const app = new Hono();

  // GET /api/timers — list active systemd user timers
  app.get("/api/timers", (c: Context) => {
    try {
      const output = execSync("systemctl --user list-timers --no-pager", {
        encoding: "utf-8",
        timeout: 10000,
      });
      const timers = parseTimersOutput(output);
      return c.json({ timers, raw: output.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to list timers: ${msg}`, code: "INTERNAL_ERROR" }, 500);
    }
  });

  return app;
}
