import { serve } from "@hono/node-server";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, openSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createApp } from "../lib/agent-api/index.js";
import { isProcessAlive } from "../utils/process.js";

const DEFAULT_PORT = 9848;
const DEFAULT_HOST = "127.0.0.1";
const PID_FILE = resolve(homedir(), ".local/share/personal-assistant/pa-serve.pid");

export interface ServeOptions {
  port: number;
  host: string;
  background: boolean;
  cors: boolean;
  force: boolean;
}

/** Read PID and port from PID file, or null if missing/invalid */
function readPidFile(): { pid: number; port: number } | null {
  if (!existsSync(PID_FILE)) return null;
  const content = readFileSync(PID_FILE, "utf8").trim();
  // Support both "PID:PORT" (new) and just "PID" (legacy)
  if (content.includes(":")) {
    const [pidStr, portStr] = content.split(":");
    const pid = parseInt(pidStr, 10);
    const port = parseInt(portStr, 10);
    if (Number.isNaN(pid) || Number.isNaN(port)) return null;
    return { pid, port };
  } else {
    // Legacy format: just PID
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : { pid, port: DEFAULT_PORT };
  }
}

/** Write current process PID and port to PID file */
function writePidFile(pid: number, port: number): void {
  const pidDir = dirname(PID_FILE);
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true });
  }
  writeFileSync(PID_FILE, `${pid}:${port}`, "utf8");
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

/** Wait for a port to become free, with timeout */
function waitForPortFree(port: number, host: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      const busy = await isPortInUse(port, host);
      if (!busy) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 200);
    };
    check();
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

  // Background mode: fork a detached child and exit immediately
  if (opts.background && !process.env["_PA_SERVE_FORKED"]) {
    const args = ["serve", "--port", String(port), "--host", host];
    if (enableCors) args.push("--cors");
    args.push("--background");

    const logDir = resolve(homedir(), ".local/share/personal-assistant");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = resolve(logDir, "pa-serve.log");
    const out = openSync(logFile, "a");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, _PA_SERVE_FORKED: "1" },
    });
    child.unref();
    console.log(`[pa serve] Started in background (PID ${child.pid}). Log: ${logFile}`);
    process.exit(0);
  }

  // Pre-start check: PID file and port conflict
  const existingPidInfo = readPidFile();

  if (existingPidInfo !== null) {
    if (isProcessAlive(existingPidInfo.pid)) {
      // Existing pa serve is running
      if (opts.force) {
        console.log(`[pa serve] Killing existing instance (PID ${existingPidInfo.pid})...`);
        await killProcess(existingPidInfo.pid);
        removePidFile();
        console.log(`[pa serve] Existing instance stopped.`);
      } else {
        console.error(`Port ${existingPidInfo.port} already in use (PID ${existingPidInfo.pid}). Use \`pa serve stop\` or \`pa serve --force\`.`);
        process.exit(1);
      }
    } else {
      // Stale PID file
      console.log(`[pa serve] Stale PID file found (PID ${existingPidInfo.pid} is dead). Cleaning up.`);
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
  writePidFile(process.pid, port);
  if (opts.background) {
    console.log(`[pa serve] Background mode — PID ${process.pid} written to ${PID_FILE}`);
  }

  // Register PID file cleanup on exit
  const cleanupPid = () => {
    removePidFile();
  };
  process.once("SIGTERM", () => {
    cleanupPid();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanupPid();
    process.exit(0);
  });
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
  const pidInfo = readPidFile();
  if (pidInfo === null) {
    console.log("No PID file found. Server may not be running.");
    return;
  }

  if (!isProcessAlive(pidInfo.pid)) {
    console.log(`PID ${pidInfo.pid} is not running. Cleaning up stale PID file.`);
    removePidFile();
    return;
  }

  console.log(`Stopping pa serve (PID ${pidInfo.pid})...`);
  await killProcess(pidInfo.pid);
  removePidFile();
  console.log("Server stopped.");
}

/** Show status of pa serve */
export function serveStatusCommand(): void {
  const pidInfo = readPidFile();
  if (pidInfo === null) {
    console.log("Status: stopped (no PID file)");
    return;
  }

  if (isProcessAlive(pidInfo.pid)) {
    console.log(`Status: running`);
    console.log(`PID:    ${pidInfo.pid}`);
    console.log(`Port:   ${pidInfo.port}`);
  } else {
    console.log(`Status: stopped (stale PID ${pidInfo.pid})`);
    removePidFile();
  }
}

/** Stop existing instance and restart, waiting for port to be free */
export async function serveRestartCommand(opts: Omit<ServeOptions, "force">): Promise<void> {
  await serveStopCommand();

  // Wait for port to be released after stopping
  const portFree = await waitForPortFree(opts.port, opts.host);
  if (!portFree) {
    console.error(`Port ${opts.port} still in use after stop. Check with: ss -tlnp | grep ${opts.port}`);
    process.exit(1);
  }

  await serveCommand({ ...opts, force: false });
}

export { DEFAULT_PORT, DEFAULT_HOST };
