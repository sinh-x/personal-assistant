import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { getAgentTeamsDir, getTeamsDir } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
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

interface ItemInfo {
  slug: string; // filename without date prefix and .md
  date: string; // YYYY-MM-DD from filename, or '?' if non-standard
  from: string; // From: frontmatter value or 'unknown'
  to: string; // To: frontmatter value or 'unknown'
}

/** Extract item info from filename + frontmatter */
function extractItemInfo(filePath: string): ItemInfo {
  const name = basename(filePath, ".md");
  const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  const date = dateMatch ? dateMatch[1] : "?";
  const slug = dateMatch ? dateMatch[2] : name;

  let from = "unknown";
  let to = "unknown";
  try {
    const content = readFileSync(filePath, "utf-8");
    const fromMatch = content.match(/^>\s+\*\*From:\*\*\s*(.+)$/m);
    const toMatch = content.match(/^>\s+\*\*To:\*\*\s*(.+)$/m);
    if (fromMatch) from = fromMatch[1].trim();
    if (toMatch) to = toMatch[1].trim();
  } catch {
    // leave from/to as 'unknown'
  }

  return { slug, date, from, to };
}

/** Get the team-level model from YAML, or "-" if not declared or YAML not found */
function getTeamModel(teamName: string): string {
  try {
    const yamlPath = resolve(getTeamsDir(), `${teamName}.yaml`);
    if (!existsSync(yamlPath)) return "-";
    const config = parseTeamYaml(yamlPath);
    return config.model ?? "-";
  } catch {
    return "-";
  }
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
      "MODEL".padEnd(9) +
      "INBOX".padEnd(8) +
      "ONGOING".padEnd(9) +
      "WFR".padEnd(7) +
      "DEPLOY"
  );

  for (const team of entries.sort()) {
    const teamDir = resolve(agentTeamsDir, team);
    const model = getTeamModel(team);
    const inbox = countMdFiles(resolve(teamDir, "inbox"));
    const ongoing = countMdFiles(resolve(teamDir, "ongoing"));
    const wfr = countMdFiles(resolve(teamDir, "waiting-for-response"));
    const running = getRunningDeploysForTeam(team);
    const deploy = running.length > 0 ? `${running[0]} [>>]` : "-";

    console.log(
      team.padEnd(20) +
        model.padEnd(9) +
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
        const info = extractItemInfo(resolve(folderDir, file));
        console.log(`  • ${info.slug}`);
        console.log(`    ${info.date} | From: ${info.from} → To: ${info.to}`);
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
