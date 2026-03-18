import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
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

/** Terminal states that indicate a deployment is done */
const TERMINAL_STATES = new Set(["success", "partial", "failed", "crashed", "dead"]);

/**
 * Block until deployment reaches a terminal state.
 * Polls registry.jsonl every 5 seconds. Exits with code 0 for
 * success/partial, code 1 for failed/crashed/dead or timeout.
 */
function waitForDeployment(did: string): void {
  const TIMEOUT_S = 10800; // 3 hours
  const startTime = Date.now();

  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed >= TIMEOUT_S) {
      console.log(`Timeout after ${TIMEOUT_S}s waiting for deployment: ${did}`);
      process.exit(1);
    }

    const events = readRegistry();
    const deployments = buildDeployments(events);
    checkLiveness(deployments);

    const rec = deployments.get(did);
    if (!rec) {
      console.log(`Deployment not found: ${did}`);
      process.exit(1);
    }

    if (TERMINAL_STATES.has(rec.status)) {
      const si = statusIcon(rec.status);
      const summary = rec.summary ?? rec.status;
      console.log(`[${si}] ${rec.status} - ${summary}`);
      const isSuccess = rec.status === "success" || rec.status === "partial";
      process.exit(isSuccess ? 0 : 1);
    }

    // Not yet terminal — sleep and poll again
    execSync("sleep 5");
  }
}

/**
 * Find and print the work report for a deployment.
 * Searches inbox and builder agent-team folders for a file whose name
 * contains the deploy-id.
 */
function showReport(did: string): void {
  const base = resolve(homedir(), "Documents/ai-usage");
  const searchDirs = [
    resolve(base, "sinh-inputs/inbox"),
    resolve(base, "agent-teams/builder/done"),
    resolve(base, "agent-teams/builder/ongoing"),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir).filter((f) => f.endsWith(".md"));

    // Fast path: deploy ID in filename
    const filenameMatch = entries.find((f) => f.includes(did));
    if (filenameMatch) {
      console.log(readFileSync(resolve(dir, filenameMatch), "utf-8"));
      return;
    }

    // Slow path: deploy ID in file content
    for (const entry of entries) {
      const filePath = resolve(dir, entry);
      const content = readFileSync(filePath, "utf-8");
      if (content.includes(did)) {
        console.log(content);
        return;
      }
    }
  }

  console.log(`No work report found for deployment: ${did}`);
}

/**
 * Recursively list all files under a directory.
 */
function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

interface ActivityEvent {
  ts: string;
  deploy_id: string;
  agent: string;
  agent_type?: string;
  event: string;
  data: Record<string, unknown>;
}

/** Format a single activity event line for timeline display */
function formatActivityLine(evt: ActivityEvent): string {
  // Extract HH:MM:SS from ISO timestamp (handles both Z and +HH:MM offsets)
  const time = evt.ts.slice(11, 19);
  const agentCol = `[${evt.agent}]`.padEnd(20);
  const eventCol = evt.event.padEnd(18);

  let detail = "";
  switch (evt.event) {
    case "agent_spawned": {
      const type = evt.agent_type ?? "";
      const desc =
        typeof evt.data.description === "string"
          ? evt.data.description.slice(0, 80)
          : "";
      detail = type ? `${type}` : "";
      if (desc) detail += ` — "${desc}"`;
      break;
    }
    case "agent_stopped": {
      const msg =
        typeof evt.data.last_message === "string"
          ? evt.data.last_message.slice(0, 100)
          : "";
      if (msg) detail = `"${msg}"`;
      break;
    }
    case "task_completed": {
      const subject =
        typeof evt.data.subject === "string" ? evt.data.subject : "";
      if (subject) detail = `"${subject}"`;
      break;
    }
  }

  return `${time}  ${agentCol} ${eventCol} ${detail}`.trimEnd();
}

/**
 * Read and display the activity timeline for a deployment.
 * Reads <deploy-workspace>/activity.jsonl and prints formatted events.
 */
function showActivity(did: string): void {
  const activityFile = resolve(
    homedir(),
    "Documents/ai-usage/deployments",
    did,
    "activity.jsonl"
  );

  if (!existsSync(activityFile)) {
    console.log(`No activity log found for deployment: ${did}`);
    console.log(`Expected: ${activityFile}`);
    return;
  }

  const raw = readFileSync(activityFile, "utf-8").trim();
  if (!raw) {
    console.log(`Activity log is empty: ${activityFile}`);
    return;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  console.log(`Activity timeline — ${did} (${lines.length} events)\n`);
  console.log(
    `${"TIME".padEnd(10)} ${"AGENT".padEnd(20)} ${"EVENT".padEnd(18)} DETAIL`
  );
  console.log(
    `${"---------".padEnd(10)} ${"-------------------".padEnd(20)} ${"------------------".padEnd(18)} ------`
  );

  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as ActivityEvent;
      console.log(formatActivityLine(evt));
    } catch {
      // Skip malformed lines silently
    }
  }
}

/**
 * List all artifact files for a deployment workspace.
 */
function showArtifacts(did: string): void {
  const workspaceDir = resolve(homedir(), "Documents/ai-usage/deployments", did);
  if (!existsSync(workspaceDir)) {
    console.log(`No workspace found for deployment: ${did}`);
    return;
  }
  const files = listFilesRecursive(workspaceDir);
  for (const f of files) {
    console.log(f);
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

  const filterMode = args[0] ?? "all";
  const filterValue = args[1] ?? "";

  // Check for new flags: <deploy-id> --wait | --report | --artifacts
  if (filterValue === "--wait") {
    waitForDeployment(filterMode);
    return;
  }
  if (filterValue === "--report") {
    showReport(filterMode);
    return;
  }
  if (filterValue === "--artifacts") {
    showArtifacts(filterMode);
    return;
  }
  if (filterValue === "--activity") {
    showActivity(filterMode);
    return;
  }

  const events = readRegistry();
  const deployments = buildDeployments(events);
  checkLiveness(deployments);

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
