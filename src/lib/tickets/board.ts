import type { Ticket, TicketStatus } from "./types.js";
import { TicketStore } from "./store.js";

/** All valid status columns in board order */
export const BOARD_COLUMNS: TicketStatus[] = [
  "idea",
  "requirement-review",
  "pending-approval",
  "pending-implementation",
  "implementing",
  "review-uat",
  "done",
  "rejected",
  "cancelled",
];

/** A single column in the board view */
export interface BoardColumn {
  status: TicketStatus;
  tickets: Ticket[];
  count: number;
}

/** Full board view for a project */
export interface BoardView {
  project: string;
  columns: BoardColumn[];
  total: number;
  /** Ticket counts per assignee (across all statuses) */
  assigneeCounts: Record<string, number>;
}

/** Per-assignee ticket counts broken down by status */
export interface TeamStatusSummary {
  team: string;
  counts: Record<TicketStatus, number>;
  total: number;
}

/**
 * Build a Kanban board view grouped by status.
 *
 * @param project - Filter by project name (required for cross-team board)
 * @param filters - Optional additional filters
 */
export function buildBoardView(
  project: string,
  filters: {
    assignee?: string;
    priority?: string;
    excludeTags?: string[];
  } = {}
): BoardView {
  const store = new TicketStore();
  const tickets = store.list({ project, ...filters });

  const grouped = new Map<TicketStatus, Ticket[]>();
  for (const status of BOARD_COLUMNS) {
    grouped.set(status, []);
  }

  const assigneeCounts: Record<string, number> = {};

  for (const ticket of tickets) {
    const col = grouped.get(ticket.status);
    if (col) {
      col.push(ticket);
    } else {
      // Unknown status — add to idea as fallback
      grouped.get("idea")!.push(ticket);
    }
    assigneeCounts[ticket.assignee] = (assigneeCounts[ticket.assignee] ?? 0) + 1;
  }

  const columns: BoardColumn[] = BOARD_COLUMNS.map((status) => {
    const col = grouped.get(status)!;
    // Sort by priority within each column (critical first)
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    col.sort(
      (a, b) =>
        (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)
    );
    return { status, tickets: col, count: col.length };
  });

  return {
    project,
    columns,
    total: tickets.length,
    assigneeCounts,
  };
}

/**
 * Get a summary of ticket counts per team, broken down by status.
 * Used by `pa teams` to show ticket health per team.
 */
export function getTeamStatusSummaries(project?: string): TeamStatusSummary[] {
  const store = new TicketStore();
  const tickets = store.list(project ? { project } : {});

  const byTeam = new Map<string, Record<TicketStatus, number>>();

  for (const ticket of tickets) {
    if (!byTeam.has(ticket.assignee)) {
      const zeroCounts: Record<TicketStatus, number> = {} as Record<TicketStatus, number>;
      for (const s of BOARD_COLUMNS) zeroCounts[s] = 0;
      byTeam.set(ticket.assignee, zeroCounts);
    }
    const counts = byTeam.get(ticket.assignee)!;
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  }

  return Array.from(byTeam.entries()).map(([team, counts]) => ({
    team,
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  }));
}

/**
 * Get all tickets for a team across all projects, grouped by status.
 */
export function getTeamBoard(
  team: string,
  filters: { project?: string } = {}
): BoardView & { team: string } {
  const store = new TicketStore();
  const tickets = store.list({ assignee: team, ...filters });

  const grouped = new Map<TicketStatus, Ticket[]>();
  for (const status of BOARD_COLUMNS) {
    grouped.set(status, []);
  }

  for (const ticket of tickets) {
    const col = grouped.get(ticket.status);
    (col ?? grouped.get("idea")!).push(ticket);
  }

  const columns: BoardColumn[] = BOARD_COLUMNS.map((status) => {
    const col = grouped.get(status)!;
    return { status, tickets: col, count: col.length };
  });

  return {
    team,
    project: filters.project ?? "all",
    columns,
    total: tickets.length,
    assigneeCounts: { [team]: tickets.length },
  };
}
