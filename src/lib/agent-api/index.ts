import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { isInsideSandbox } from "./utils/sandbox.js";
import { inboxRoutes } from "./routes/inbox.js";
import { foldersRoutes } from "./routes/folders.js";
import { configRoutes } from "./routes/config.js";
import { deploymentsRoutes } from "./routes/deployments.js";
import { teamsRoutes } from "./routes/teams.js";
import { deployRoutes } from "./routes/deploy.js";
import { ideasRoutes } from "./routes/ideas.js";
import { timersRoutes } from "./routes/timers.js";
import { sinhInputsRoutes } from "./routes/sinh-inputs.js";

export interface AgentApiOptions {
  enableCors: boolean;
}

export function createApp(opts: AgentApiOptions): Hono {
  const app = new Hono();

  // CORS middleware (only when --cors flag is passed)
  if (opts.enableCors) {
    app.use("*", cors());
  }

  // Security middleware: path traversal protection for any ?path= query param
  app.use("*", async (c: Context, next: Next) => {
    const pathParam = c.req.query("path");
    if (pathParam !== undefined && !isInsideSandbox(pathParam)) {
      return c.json({ error: "Path traversal denied", code: "SANDBOX_VIOLATION" }, 403);
    }
    await next();
  });

  // Error handler
  app.onError((err: Error, c: Context) => {
    console.error("[agent-api] error:", err.message);
    return c.json({ error: err.message, code: "INTERNAL_ERROR" }, 500);
  });

  // Health endpoint
  app.get("/api/health", (c: Context) => {
    return c.json({ status: "ok" });
  });

  // Route modules
  app.route("/", inboxRoutes());
  app.route("/", foldersRoutes());
  app.route("/", configRoutes());
  app.route("/", deploymentsRoutes());
  app.route("/", teamsRoutes());
  app.route("/", deployRoutes());
  app.route("/", ideasRoutes());
  app.route("/", timersRoutes());
  app.route("/", sinhInputsRoutes());

  return app;
}
