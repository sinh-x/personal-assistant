import { serve } from "@hono/node-server";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createApp } from "../lib/agent-api/index.js";

const DEFAULT_PORT = 9848;
const DEFAULT_HOST = "0.0.0.0";
const PID_FILE = resolve(homedir(), ".local/share/personal-assistant/pa-serve.pid");

export interface ServeOptions {
  port: number;
  host: string;
  background: boolean;
  cors: boolean;
}

export async function serveCommand(opts: ServeOptions): Promise<void> {
  const { port, host, cors: enableCors } = opts;

  if (opts.background) {
    // Write PID file for background process management
    const pidDir = dirname(PID_FILE);
    if (!existsSync(pidDir)) {
      mkdirSync(pidDir, { recursive: true });
    }
    writeFileSync(PID_FILE, String(process.pid), "utf8");
    console.log(`[pa serve] Background mode — PID ${process.pid} written to ${PID_FILE}`);
  }

  const { app, injectWebSocket } = createApp({ enableCors });

  console.log(`[pa serve] Starting agent API on http://${host}:${port}`);

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      console.log(`[pa serve] Listening on http://${info.address}:${info.port}`);
    },
  );

  injectWebSocket(server);
}

export { DEFAULT_PORT, DEFAULT_HOST };
