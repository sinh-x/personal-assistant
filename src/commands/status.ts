import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { readRegistry } from "../lib/registry.js";
import { getDataDir } from "../lib/paths.js";
import { isProcessAlive } from "../utils/process.js";
import type { RegistryEvent } from "../lib/types.js";

interface DeploymentRecord {
  team: string;
  started: string;
  pid?: number;
  status: string;
  ended?: string;
  summary?: string;
  agents: string;
  primer?: string;
}

/** Format ISO timestamp to short form: "YYYY-MM-DD HH:MM:SS" */
function shortTs(ts: string): string {
  return ts.replace("T", " ").slice(0, 19);
}

/** Get status icon for a status string */
function statusIcon(status: string): string {
  switch (status) {
    case "success":
      return "OK";
    case "partial":
      return "..";
    case "failed":
    case "crashed":
    case "dead":
      return "!!";
    case "running":
      return ">>";
    default:
      return "??";
  }
}

/** Parse registry events into deployment records */
function buildDeployments(events: RegistryEvent[]): Map<string, DeploymentRecord> {
  const deployments = new Map<string, DeploymentRecord>();

  for (const event of events) {
    const did = event.deployment_id;
    if (!did) continue;

    switch (event.event) {
      case "started": {
        const agents = event.agents ? event.agents.join(",") : "";
        deployments.set(did, {
          team: event.team,
          started: event.timestamp,
          agents,
          primer: event.primer,
          status: "running",
        });
        break;
      }
      case "pid": {
        const rec = deployments.get(did);
        if (rec && event.pid !== undefined) {
          rec.pid = event.pid;
        }
        break;
      }
      case "completed": {
        const rec = deployments.get(did);
        if (rec) {
          rec.status = event.status ?? "success";
          rec.ended = event.timestamp;
          rec.summary = event.summary;
        }
        break;
      }
      case "crashed": {
        const rec = deployments.get(did);
        if (rec) {
          rec.status = "crashed";
          rec.ended = event.timestamp;
          rec.summary = event.exit_code !== undefined
            ? `exit code ${event.exit_code}`
            : undefined;
        }
        break;
      }
    }
  }

  return deployments;
}

/** Check if "running" deployments are actually still alive */
function checkLiveness(deployments: Map<string, DeploymentRecord>): void {
  for (const [, rec] of deployments) {
    if (rec.status === "running" && rec.pid !== undefined) {
      if (!isProcessAlive(rec.pid)) {
        rec.status = "dead";
        rec.summary = `PID ${rec.pid} no longer running (no completion marker)`;
      }
    }
  }
}

/** Show detail view for a single deployment */
function showDetail(did: string, rec: DeploymentRecord): void {
  const logsDir = resolve(getDataDir(), "logs");
  const si = statusIcon(rec.status);

  console.log(`Deployment: ${did}`);
  console.log(`  Team:     ${rec.team}`);
  console.log(`  Status:   [${si}] ${rec.status}`);
  console.log(`  Started:  ${shortTs(rec.started)}`);

  if (rec.ended) {
    console.log(`  Ended:    ${shortTs(rec.ended)}`);
  }

  // Show runtime
  const startEpoch = new Date(rec.started).getTime();
  if (!isNaN(startEpoch)) {
    const endEpoch = rec.ended
      ? new Date(rec.ended).getTime()
      : Date.now();
    if (!isNaN(endEpoch)) {
      const elapsed = Math.floor((endEpoch - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      console.log(`  Runtime:  ${mins}m ${secs}s`);
    }
  }

  console.log(`  Agents:   ${rec.agents || "none"}`);
  if (rec.pid !== undefined) {
    console.log(`  PID:      ${rec.pid}`);
  }
  if (rec.summary) {
    console.log(`  Summary:  ${rec.summary}`);
  }

  // Show log file if exists
  const logFile = resolve(logsDir, `${rec.team}-${did}.log`);
  if (existsSync(logFile)) {
    const stat = statSync(logFile);
    const logSize = stat.size;
    console.log(`  Log:      ${logFile} (${logSize} bytes)`);
    if (logSize === 0) {
      console.log("");
      console.log("  WARNING: Log is empty — process may be stuck");
    } else {
      console.log("");
      console.log("--- Last 20 lines of log ---");
      const content = readFileSync(logFile, "utf-8");
      const lines = content.split("\n");
      const last20 = lines.slice(-21).join("\n");
      process.stdout.write(last20);
    }
  }

  // Show primer file
  if (rec.primer && existsSync(rec.primer)) {
    console.log(`  Primer:   ${rec.primer}`);
  }
}

/** Show list view of deployments */
function showList(
  deployments: Map<string, DeploymentRecord>,
  filterMode: string,
  filterValue: string
): void {
  // Sort by start time, most recent first
  const sorted = [...deployments.entries()].sort((a, b) =>
    b[1].started.localeCompare(a[1].started)
  );

  // Header — matches bash printf format
  console.log(
    `${"DEPLOY-ID".padEnd(12)} ${"TEAM".padEnd(22)} ${"STATUS".padEnd(10)} ${"STARTED".padEnd(20)} ${"ENDED".padEnd(20)} SUMMARY`
  );
  console.log(
    `${"-----------".padEnd(12)} ${"---------------------".padEnd(22)} ${"---------".padEnd(10)} ${"-------------------".padEnd(20)} ${"-------------------".padEnd(20)} -------`
  );

  for (const [did, rec] of sorted) {
    // Apply filters
    if (filterMode === "--running" && rec.status !== "running") continue;
    if (filterMode === "--team" && rec.team !== filterValue) continue;

    const si = statusIcon(rec.status);
    const started = shortTs(rec.started);
    const ended = rec.ended ? shortTs(rec.ended) : "-";
    let summary = rec.summary ?? "";
    if (summary.length > 50) {
      summary = summary.slice(0, 47) + "...";
    }

    // Match bash printf: "%-12s %-22s [%-2s] %-4s %-20s %-20s %s"
    console.log(
      `${did.padEnd(12)} ${rec.team.padEnd(22)} [${si.padEnd(2)}] ${"".padEnd(4)} ${started.padEnd(20)} ${ended.padEnd(20)} ${summary}`
    );
  }
}

/**
 * Show deployment status from the registry.
 * Replaces status.sh (200 lines).
 */
export function statusCommand(args: string[]): void {
  const deploymentsDir = resolve(homedir(), "Documents/ai-usage/deployments");
  const registryFile = resolve(deploymentsDir, "registry.jsonl");

  if (!existsSync(registryFile)) {
    console.log(`No deployments yet. Registry not found: ${registryFile}`);
    return;
  }

  const events = readRegistry();
  const deployments = buildDeployments(events);
  checkLiveness(deployments);

  const filterMode = args[0] ?? "all";
  const filterValue = args[1] ?? "";

  // Detail view for a specific deployment ID
  if (filterMode !== "all" && filterMode !== "--running" && filterMode !== "--team") {
    const did = filterMode;
    const rec = deployments.get(did);
    if (!rec) {
      console.log(`Deployment not found: ${did}`);
      process.exit(1);
    }
    showDetail(did, rec);
    return;
  }

  // List view
  showList(deployments, filterMode, filterValue);
}
