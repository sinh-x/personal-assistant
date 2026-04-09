import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Server } from "node:http";
import type { Http2SecureServer, Http2Server } from "node:http2";
import { isInsideSandbox, normalizeSandboxPath } from "./utils/sandbox.js";
import { inboxRoutes } from "./routes/inbox.js";
import { foldersRoutes } from "./routes/folders.js";
import { configRoutes } from "./routes/config.js";
import { deploymentsRoutes } from "./routes/deployments.js";
import { repoDeploymentsRoutes } from "./routes/repo-deployments.js";
import { reposRoutes } from "./routes/repos.js";
import { repoCommitsRoutes } from "./routes/repo-commits.js";
import { teamsRoutes } from "./routes/teams.js";
import { deployRoutes } from "./routes/deploy.js";
import { deployRoutingRoutes } from "./routes/deploy-routing.js";
import { ideasRoutes } from "./routes/ideas.js";
import { timersRoutes } from "./routes/timers.js";
import { sinhInputsRoutes } from "./routes/sinh-inputs.js";
import { ticketRoutes } from "./routes/tickets.js";
import { focusRoutes } from "./routes/focus.js";
import { bulletinRoutes } from "./routes/bulletin.js";
import { documentsRoutes } from "./routes/documents.js";
import { hub } from "./ws/hub.js";
import { startWatchers } from "./ws/watchers.js";

export interface AgentApiOptions {
  enableCors: boolean;
}

export interface AgentApiInstance {
  app: Hono;
  injectWebSocket: (
    server: Server | Http2Server | Http2SecureServer,
  ) => void;
}

export function createApp(opts: AgentApiOptions): AgentApiInstance {
  const app = new Hono();

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  // CORS middleware (only when --cors flag is passed)
  if (opts.enableCors) {
    app.use("*", cors());
  }

  // Security middleware: path traversal protection for any ?path= query param
  // Normalizes relative/tilde paths to absolute before sandbox check
  app.use("*", async (c: Context, next: Next) => {
    const pathParam = c.req.query("path");
    if (pathParam !== undefined && !isInsideSandbox(normalizeSandboxPath(pathParam))) {
      return c.json({ error: "Path traversal denied", code: "SANDBOX_VIOLATION" }, 403);
    }
    // Block path traversal attempts in the URL path (e.g., /api/repos/../etc)
    const rawPath = c.req.path;
    if (rawPath.includes("..")) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
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

  // WebSocket endpoint
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        hub.addClient(ws);
      },
      onMessage(evt, ws) {
        try {
          const msg = JSON.parse(evt.data as string) as Record<string, unknown>;
          if (msg["type"] === "pong") {
            hub.recordPong(ws);
          }
        } catch {
          /* ignore non-JSON messages */
        }
      },
      onClose(_evt, ws) {
        hub.removeClient(ws);
      },
      onError(_evt, ws) {
        hub.removeClient(ws);
      },
    })),
  );

  // Route modules
  app.route("/", inboxRoutes());
  app.route("/", foldersRoutes());
  app.route("/", configRoutes());
  app.route("/", deploymentsRoutes());
  app.route("/", reposRoutes());
  app.route("/", repoCommitsRoutes());
  app.route("/", repoDeploymentsRoutes());
  app.route("/", teamsRoutes());
  app.route("/", deployRoutes());
  app.route("/", deployRoutingRoutes());
  app.route("/", ideasRoutes());
  app.route("/", timersRoutes());
  app.route("/", sinhInputsRoutes());
  app.route("/", ticketRoutes());
  app.route("/", focusRoutes());
  app.route("/", bulletinRoutes());
  app.route("/", documentsRoutes());

  // Start hub ping and file watchers
  hub.startPing();
  const watchers = startWatchers(hub);

  // Graceful shutdown
  const cleanup = () => {
    watchers.cleanup();
    hub.cleanup();
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  return { app, injectWebSocket };
}
