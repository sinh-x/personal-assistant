import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentTeamsDir, getTeamsDir } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
import { readRegistry } from "../lib/registry.js";
import { isProcessAlive } from "../utils/process.js";
import type { RegistryEvent } from "../lib/types.js";
import {
  getTeamStatusSummaries,
  getTeamBoard,
  buildBoardView,
  BOARD_COLUMNS,
} from "../lib/tickets/board.js";
import type { BoardView } from "../lib/tickets/board.js";

// ANSI color helpers (no-op when not a TTY)
const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function colorByPriority(text: string, priority: string): string {
  if (!process.stdout.isTTY) return text;
  switch (priority) {
    case "critical":
      return `${COLORS.red}${text}${COLORS.reset}`;
    case "high":
      return `${COLORS.yellow}${text}${COLORS.reset}`;
    case "low":
      return `${COLORS.dim}${text}${COLORS.reset}`;
    default:
      return text;
  }
}

/** Short header names for kanban status columns */
const STATUS_ABBREV: Record<string, string> = {
  "idea": "IDEA",
  "requirement-review": "REQ",
  "pending-approval": "APRV",
  "pending-implementation": "IMPL",
  "implementing": "BILD",
  "review-uat": "UAT",
  "done": "DONE",
  "rejected": "REJ",
  "on-hold": "HOLD",
  "cancelled": "CNCL",
};

/** padEnd widths for each status column in summary table */
const STATUS_WIDTH: Record<string, number> = {
  "idea": 6,
  "requirement-review": 5,
  "pending-approval": 6,
  "pending-implementation": 6,
  "implementing": 6,
  "review-uat": 5,
  "done": 6,
  "rejected": 5,
  "on-hold": 6,
  "cancelled": 6,
};

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

  const running: string[] = [];
  for (const [id, rec] of deployments) {
    if (rec.status !== "running") continue;
    if (rec.pid !== undefined && !isProcessAlive(rec.pid)) continue;
    if (rec.pid === undefined) continue;
    running.push(id);
  }
  return running;
}

/** Build a separator column segment matching a padEnd(width) column */
function makeSepCol(width: number): string {
  return "─".repeat(width - 2) + "  ";
}

/** Show kanban summary table of all agent teams */
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

  // Gather per-team, per-status ticket counts
  const ticketMap = new Map<string, Record<string, number>>();
  try {
    const summaries = getTeamStatusSummaries();
    for (const s of summaries) {
      ticketMap.set(s.team, s.counts as Record<string, number>);
    }
  } catch {
    /* ticket system may not be initialized yet */
  }

  // Header row
  let header = "TEAM".padEnd(18) + "MODEL".padEnd(9);
  for (const status of BOARD_COLUMNS) {
    header += STATUS_ABBREV[status].padEnd(STATUS_WIDTH[status]);
  }
  header += "DEPLOY";
  console.log(header);

  // Separator row
  let sep = makeSepCol(18) + makeSepCol(9);
  for (const status of BOARD_COLUMNS) {
    sep += makeSepCol(STATUS_WIDTH[status]);
  }
  sep += "─".repeat(14);
  console.log(sep);

  // Data rows
  for (const team of entries.sort()) {
    const model = getTeamModel(team);
    const counts = ticketMap.get(team) ?? {};
    const running = getRunningDeploysForTeam(team);
    const deploy = running.length > 0 ? `${running[0]} [>>]` : "-";

    let line = team.padEnd(18) + model.padEnd(9);
    for (const status of BOARD_COLUMNS) {
      line += String(counts[status] ?? 0).padEnd(STATUS_WIDTH[status]);
    }
    line += deploy;
    console.log(line);
  }
}

const DETAIL_WIDTH = 64;

/** Show kanban board detail view for one team */
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
  console.log("═".repeat(DETAIL_WIDTH));

  let board;
  try {
    board = getTeamBoard(name);
  } catch {
    console.log("\n(ticket system unavailable)");
    const running = getRunningDeploysForTeam(name);
    console.log(
      running.length > 0
        ? `\ndeployments: ${running.join(", ")}`
        : "\ndeployments: none running"
    );
    return;
  }

  for (const col of board.columns) {
    const prefix = `── ${col.status} (${col.count}) `;
    const fill = Math.max(2, DETAIL_WIDTH - prefix.length);
    console.log(`\n${prefix}${"─".repeat(fill)}`);

    if (col.tickets.length === 0) {
      console.log("  (empty)");
    } else {
      for (const ticket of col.tickets) {
        const priorityTag = colorByPriority(
          `[${ticket.priority}]`,
          ticket.priority
        );
        console.log(`  ${ticket.id.padEnd(8)}${priorityTag}  ${ticket.title}`);
        if (ticket.summary) {
          const summary =
            ticket.summary.length > 80
              ? ticket.summary.slice(0, 77) + "..."
              : ticket.summary;
          console.log(`          ${summary}`);
        }
      }
    }
  }

  const running = getRunningDeploysForTeam(name);
  console.log(
    running.length > 0
      ? `\ndeployments: ${running.join(", ")}`
      : "\ndeployments: none running"
  );
}

/** Show project-wide kanban board, optionally filtered by assignee */
function showBoard(
  project: string,
  filters: { assignee?: string } = {}
): void {
  let board: BoardView;
  try {
    board = buildBoardView(project, filters);
  } catch {
    console.error("(ticket system unavailable)");
    return;
  }

  const filterDesc = [
    filters.assignee ? `assignee:${filters.assignee}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const title = filterDesc
    ? `Board: ${project}  [${filterDesc}]`
    : `Board: ${project}  (all tickets)`;
  console.log(title);
  console.log("═".repeat(DETAIL_WIDTH));

  for (const col of board.columns) {
    if (col.tickets.length === 0) continue;
    const prefix = `── ${col.status} (${col.count}) `;
    const fill = Math.max(2, DETAIL_WIDTH - prefix.length);
    console.log(`\n${prefix}${"─".repeat(fill)}`);

    for (const ticket of col.tickets) {
      const rawPriority = `[${ticket.priority}]`;
      const coloredPriority = colorByPriority(rawPriority, ticket.priority);
      const assignee = (ticket.assignee || "(unassigned)").padEnd(16);
      console.log(
        `  ${ticket.id.padEnd(8)}${coloredPriority}${"".padEnd(Math.max(1, 11 - rawPriority.length))}${assignee}  ${ticket.title}`
      );
    }
  }

  console.log(`\n(${board.total} total)`);
}

/**
 * Show project-wide kanban board (all tickets by status, with assignee).
 * Default project: personal-assistant.
 * Optional --assignee filter.
 */
export function boardCommand(
  project: string,
  filters: { assignee?: string } = {}
): void {
  showBoard(project, filters);
}

/**
 * Show agent team kanban board.
 * Without name: summary table of all teams with per-status ticket counts.
 * With name: kanban board for one team, tickets grouped by status.
 */
export function teamsCommand(name?: string): void {
  if (name) {
    showOneTeam(name);
  } else {
    showAllTeams();
  }
}
