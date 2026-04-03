import { serve } from "@hono/node-server";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { createApp } from "../lib/agent-api/index.js";
import { isProcessAlive } from "../utils/process.js";

const DEFAULT_PORT = 9848;
const DEFAULT_HOST = "0.0.0.0";
const PID_FILE = resolve(homedir(), ".local/share/personal-assistant/pa-serve.pid");

export interface ServeOptions {
  port: number;
  host: string;
  background: boolean;
  cors: boolean;
  force: boolean;
}

/** Read PID from PID file, or null if missing/invalid */
function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const content = readFileSync(PID_FILE, "utf8").trim();
  const pid = parseInt(content, 10);
  return Number.isNaN(pid) ? null : pid;
}

/** Write current process PID to PID file */
function writePidFile(pid: number): void {
  const pidDir = dirname(PID_FILE);
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true });
  }
  writeFileSync(PID_FILE, String(pid), "utf8");
}

/** Remove PID file if it exists */
function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore if already gone
  }
}

/** Check if a port is in use by attempting to bind */
function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, host);
  });
}

/** Kill a process by PID — SIGTERM then SIGKILL after timeout */
function killProcess(pid: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already dead
      resolve(true);
      return;
    }

    const start = Date.now();
    const check = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(check);
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already dead
        }
        resolve(true);
      }
    }, 100);
  });
}

export async function serveCommand(opts: ServeOptions): Promise<void> {
  const { port, host, cors: enableCors } = opts;

  // Pre-start check: PID file and port conflict
  const existingPid = readPidFile();

  if (existingPid !== null) {
    if (isProcessAlive(existingPid)) {
      // Existing pa serve is running
      if (opts.force) {
        console.log(`[pa serve] Killing existing instance (PID ${existingPid})...`);
        await killProcess(existingPid);
        removePidFile();
        console.log(`[pa serve] Existing instance stopped.`);
      } else {
        console.error(`Port ${port} already in use (PID ${existingPid}). Use \`pa serve stop\` or \`pa serve --force\`.`);
        process.exit(1);
      }
    } else {
      // Stale PID file
      console.log(`[pa serve] Stale PID file found (PID ${existingPid} is dead). Cleaning up.`);
      removePidFile();
    }
  } else {
    // No PID file — check if port is in use by an unknown process
    const portBusy = await isPortInUse(port, host);
    if (portBusy) {
      if (opts.force) {
        console.error(`Port ${port} in use by unknown process. Cannot --force without PID file. Check with: ss -tlnp | grep ${port}`);
        process.exit(1);
      } else {
        console.error(`Port ${port} in use by unknown process (no PID file). Check with: ss -tlnp | grep ${port}`);
        process.exit(1);
      }
    }
  }

  // Write PID file (always, both foreground and background)
  writePidFile(process.pid);
  if (opts.background) {
    console.log(`[pa serve] Background mode — PID ${process.pid} written to ${PID_FILE}`);
  }

  // Register PID file cleanup on exit
  const cleanupPid = () => {
    removePidFile();
  };
  process.once("SIGTERM", cleanupPid);
  process.once("SIGINT", cleanupPid);
  process.once("exit", cleanupPid);

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

/** Stop a running pa serve instance */
export async function serveStopCommand(): Promise<void> {
  const pid = readPidFile();
  if (pid === null) {
    console.log("No PID file found. Server may not be running.");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log(`PID ${pid} is not running. Cleaning up stale PID file.`);
    removePidFile();
    return;
  }

  console.log(`Stopping pa serve (PID ${pid})...`);
  await killProcess(pid);
  removePidFile();
  console.log("Server stopped.");
}

/** Show status of pa serve */
export function serveStatusCommand(): void {
  const pid = readPidFile();
  if (pid === null) {
    console.log("Status: stopped (no PID file)");
    return;
  }

  if (isProcessAlive(pid)) {
    console.log(`Status: running`);
    console.log(`PID:    ${pid}`);
    console.log(`Port:   ${DEFAULT_PORT}`);
  } else {
    console.log(`Status: stopped (stale PID ${pid})`);
    removePidFile();
  }
}

export { DEFAULT_PORT, DEFAULT_HOST };
