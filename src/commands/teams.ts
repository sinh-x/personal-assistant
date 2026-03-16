import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { getAgentTeamsDir } from "../lib/paths.js";
import { readRegistry } from "../lib/registry.js";
import { isProcessAlive } from "../utils/process.js";
import type { RegistryEvent } from "../lib/types.js";

/** Count .md files in a directory (returns 0 if dir missing) */
function countMdFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

/** List .md filenames in a directory (returns [] if dir missing) */
function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/** Extract title from a markdown file — first `# ` heading or filename slug */
function extractTitle(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through to filename
  }
  return basename(filePath, ".md").replace(/-/g, " ");
}

/** Get running deployment IDs for a specific team */
function getRunningDeploysForTeam(teamName: string): string[] {
  const events = readRegistry();

  // Build deployment records filtered by team
  const deployments = new Map<string, { status: string; pid?: number }>();
  for (const event of events) {
    if (event.team !== teamName) continue;
    const did = event.deployment_id;
    if (!did) continue;

    switch (event.event as RegistryEvent["event"]) {
      case "started":
        deployments.set(did, { status: "running" });
        break;
      case "pid": {
        const rec = deployments.get(did);
        if (rec && event.pid !== undefined) rec.pid = event.pid;
        break;
      }
      case "completed":
      case "crashed": {
        const rec = deployments.get(did);
        if (rec) rec.status = event.event;
        break;
      }
    }
  }

  // Return only those still running with a live PID
  const running: string[] = [];
  for (const [id, rec] of deployments) {
    if (rec.status !== "running") continue;
    if (rec.pid !== undefined && !isProcessAlive(rec.pid)) continue;
    if (rec.pid === undefined) continue;
    running.push(id);
  }
  return running;
}

/** Show summary table of all agent teams */
function showAllTeams(): void {
  const agentTeamsDir = getAgentTeamsDir();
  if (!existsSync(agentTeamsDir)) {
    console.log(
      "No agent teams workspace found at ~/Documents/ai-usage/agent-teams/"
    );
    return;
  }

  const entries = readdirSync(agentTeamsDir).filter((f) =>
    statSync(resolve(agentTeamsDir, f)).isDirectory()
  );

  if (entries.length === 0) {
    console.log("No team workspaces found.");
    return;
  }

  console.log(
    "TEAM".padEnd(20) +
      "INBOX".padEnd(8) +
      "ONGOING".padEnd(9) +
      "WFR".padEnd(7) +
      "DEPLOY"
  );

  for (const team of entries.sort()) {
    const teamDir = resolve(agentTeamsDir, team);
    const inbox = countMdFiles(resolve(teamDir, "inbox"));
    const ongoing = countMdFiles(resolve(teamDir, "ongoing"));
    const wfr = countMdFiles(resolve(teamDir, "waiting-for-response"));
    const running = getRunningDeploysForTeam(team);
    const deploy = running.length > 0 ? `${running[0]} [>>]` : "-";

    console.log(
      team.padEnd(20) +
        String(inbox).padEnd(8) +
        String(ongoing).padEnd(9) +
        String(wfr).padEnd(7) +
        deploy
    );
  }
}

/** Show detailed folder view for one team */
function showOneTeam(name: string): void {
  const agentTeamsDir = getAgentTeamsDir();
  const teamDir = resolve(agentTeamsDir, name);

  if (!existsSync(teamDir)) {
    console.error(
      `Team '${name}' not found at ~/Documents/ai-usage/agent-teams/${name}/`
    );
    process.exit(1);
  }

  console.log(name);
  console.log("─".repeat(34));

  for (const folder of ["inbox", "ongoing", "waiting-for-response"] as const) {
    const folderDir = resolve(teamDir, folder);
    const files = listMdFiles(folderDir);

    console.log(`\n${folder} (${files.length})`);
    if (files.length === 0) {
      console.log("  (empty)");
    } else {
      for (const file of files) {
        const title = extractTitle(resolve(folderDir, file));
        console.log(`  • ${title}`);
      }
    }
  }

  const doneCount = countMdFiles(resolve(teamDir, "done"));
  console.log(`\ndone: ${doneCount} items`);

  const running = getRunningDeploysForTeam(name);
  if (running.length > 0) {
    console.log(`\ndeployments: ${running.join(", ")}`);
  } else {
    console.log("\ndeployments: none running");
  }
}

/**
 * Show agent team workflow status.
 * Without name: summary table of all teams (inbox/ongoing/wfr counts + running deploy).
 * With name: full folder view for one team.
 */
export function teamsCommand(name?: string): void {
  if (name) {
    showOneTeam(name);
  } else {
    showAllTeams();
  }
}
