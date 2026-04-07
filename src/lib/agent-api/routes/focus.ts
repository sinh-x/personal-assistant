/**
 * Focus API routes — GTD cross-project focus view.
 *
 * GET /api/focus              — returns { focus: FocusItem[], wip: WipSummary }
 * GET /api/focus?enrich=true  — returns { focus, wip, suggestions, report_age_minutes }
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { buildFocusList, readLatestFocusReport } from "../../tickets/focus.js";

export function focusRoutes(): Hono {
  const app = new Hono();

  // GET /api/focus — focus list with optional AI enrichment
  app.get("/api/focus", (c: Context) => {
    const enrich = c.req.query("enrich") === "true";
    const project = c.req.query("project") || undefined;
    const assignee = c.req.query("assignee") || undefined;
    const includeAll = c.req.query("all") === "true";

    try {
      const result = buildFocusList({ project, assignee, includeAll });

      if (enrich) {
        const report = readLatestFocusReport();
        if (report) {
          return c.json({
            focus: result.focus,
            wip: result.wip,
            suggestions: report.suggestions,
            report_age_minutes: report.age_minutes,
          });
        }
        // Gracefully handle no report yet
        return c.json({
          focus: result.focus,
          wip: result.wip,
          suggestions: [],
          report_age_minutes: null,
        });
      }

      return c.json({ focus: result.focus, wip: result.wip });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "FOCUS_FAILED" }, 500);
    }
  });

  return app;
}
