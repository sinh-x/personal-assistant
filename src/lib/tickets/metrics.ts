import type { AuditEntry, Ticket, Estimate } from "./types.js";
import { TERMINAL_STATUSES, ACTIVE_STATUSES } from "./types.js";
import { TicketStore } from "./store.js";

/** Effort sizes mapped to notional story points for velocity calculation */
const ESTIMATE_POINTS: Record<Estimate, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 5,
  XL: 8,
};

/** Sprint metrics computed from the audit log and ticket data */
export interface SprintMetrics {
  /** Date range of the sprint */
  startDate: string;
  endDate: string;

  /** Total tickets completed (terminal statuses) */
  throughput: number;

  /** Average time from pending-implementation → done (in hours) */
  avgCycleTimeHours: number;

  /** Total story points completed (estimate-based) */
  velocityPoints: number;

  /** Average time tickets spent blocked (in hours) */
  avgBlockedTimeHours: number;

  /** Estimation accuracy: % of tickets where estimate matched actual cycle time bucket */
  estimationAccuracyPct: number;

  /** Tickets that were not completed by sprint end (carried over) */
  carryOverCount: number;
  carryOverPct: number;

  /** Breakdown by team */
  byTeam: Record<string, TeamSprintMetrics>;

  /** Breakdown by estimate bucket */
  byEstimate: Record<Estimate, EstimateMetrics>;
}

export interface TeamSprintMetrics {
  team: string;
  throughput: number;
  velocityPoints: number;
  avgCycleTimeHours: number;
  carryOverCount: number;
}

export interface EstimateMetrics {
  estimate: Estimate;
  count: number;
  avgActualCycleTimeHours: number;
  points: number;
}

/** Internal helper: milliseconds → hours */
function msToHours(ms: number): number {
  return ms / (1000 * 60 * 60);
}

/** Parse ISO timestamp to Date, returning null if invalid */
function parseTs(ts: string): Date | null {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Find the timestamp when a ticket first entered a given status,
 * using the audit log entries for that ticket.
 */
function findStatusEntryTime(
  ticketId: string,
  status: string,
  audit: AuditEntry[]
): Date | null {
  const entries = audit
    .filter((e) => e.ticket_id === ticketId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const entry of entries) {
    const statusChange = entry.changes["status"];
    if (statusChange && statusChange[1] === status) {
      return parseTs(entry.timestamp);
    }
  }
  return null;
}

/**
 * Compute the expected cycle time bucket for an estimate.
 * Used for estimation accuracy comparison.
 */
function estimateToCycleTimeBucket(estimate: Estimate): [number, number] {
  // Expected hours per estimate bucket [min, max]
  const buckets: Record<Estimate, [number, number]> = {
    XS: [0, 2],
    S: [2, 8],
    M: [8, 24],
    L: [24, 72],
    XL: [72, Infinity],
  };
  return buckets[estimate];
}

/**
 * Compute sprint metrics for a date range and optional project filter.
 *
 * Uses the audit log as ground truth for timing.
 * Tickets completed (status → done or failed) within the window are counted.
 * Tickets still in todo/doing/review at endDate are counted as carry-overs.
 *
 * @param startDate - ISO date string (inclusive)
 * @param endDate   - ISO date string (inclusive)
 * @param project   - Optional project filter
 */
export function computeSprintMetrics(
  startDate: string,
  endDate: string,
  project?: string
): SprintMetrics {
  const store = new TicketStore();
  const allTickets = store.list(project ? { project } : {});
  const audit = store.readAudit();

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Tickets completed within the sprint window
  const completed: Ticket[] = [];
  // Tickets still active at end of sprint (carry-overs)
  const activeAtEnd: Ticket[] = [];

  for (const ticket of allTickets) {
    const isTerminal = TERMINAL_STATUSES.includes(ticket.status);
    const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;

    if (isTerminal && resolvedAt && resolvedAt >= start && resolvedAt <= end) {
      completed.push(ticket);
    } else if (!isTerminal && ACTIVE_STATUSES.includes(ticket.status)) {
      const createdAt = new Date(ticket.createdAt);
      if (createdAt <= end) {
        activeAtEnd.push(ticket);
      }
    }
  }

  // Cycle time: time from first entering "pending-implementation" to resolution
  const cycleTimes: number[] = [];
  let accurateEstimates = 0;

  for (const ticket of completed) {
    const todoTime = findStatusEntryTime(ticket.id, "pending-implementation", audit);
    const resolvedAt = ticket.resolvedAt ? parseTs(ticket.resolvedAt) : null;

    if (todoTime && resolvedAt) {
      const cycleHours = msToHours(resolvedAt.getTime() - todoTime.getTime());
      cycleTimes.push(cycleHours);

      // Estimation accuracy: did the actual cycle time fall in the estimate's bucket?
      const [minH, maxH] = estimateToCycleTimeBucket(ticket.estimate);
      if (cycleHours >= minH && cycleHours < maxH) {
        accurateEstimates++;
      }
    }
  }

  const avgCycleTimeHours =
    cycleTimes.length > 0
      ? cycleTimes.reduce((s, h) => s + h, 0) / cycleTimes.length
      : 0;

  const velocityPoints = completed.reduce(
    (sum, t) => sum + (ESTIMATE_POINTS[t.estimate] ?? 0),
    0
  );

  const estimationAccuracyPct =
    completed.length > 0 ? (accurateEstimates / completed.length) * 100 : 0;

  const carryOverCount = activeAtEnd.length;
  const carryOverPct =
    allTickets.length > 0 ? (carryOverCount / allTickets.length) * 100 : 0;

  // By-team breakdown
  const teamMap = new Map<string, { tickets: Ticket[]; cycleTimes: number[] }>();
  for (const ticket of completed) {
    if (!teamMap.has(ticket.team)) {
      teamMap.set(ticket.team, { tickets: [], cycleTimes: [] });
    }
    teamMap.get(ticket.team)!.tickets.push(ticket);
  }
  for (const ticket of completed) {
    const implTime = findStatusEntryTime(ticket.id, "pending-implementation", audit);
    const resolvedAt = ticket.resolvedAt ? parseTs(ticket.resolvedAt) : null;
    if (implTime && resolvedAt) {
      const h = msToHours(resolvedAt.getTime() - implTime.getTime());
      teamMap.get(ticket.team)?.cycleTimes.push(h);
    }
  }

  const byTeam: Record<string, TeamSprintMetrics> = {};
  for (const [team, data] of teamMap.entries()) {
    const teamCarryOver = activeAtEnd.filter((t) => t.team === team).length;
    const teamAvgCycle =
      data.cycleTimes.length > 0
        ? data.cycleTimes.reduce((s, h) => s + h, 0) / data.cycleTimes.length
        : 0;
    byTeam[team] = {
      team,
      throughput: data.tickets.length,
      velocityPoints: data.tickets.reduce(
        (sum, t) => sum + (ESTIMATE_POINTS[t.estimate] ?? 0),
        0
      ),
      avgCycleTimeHours: teamAvgCycle,
      carryOverCount: teamCarryOver,
    };
  }

  // By-estimate breakdown
  const estimateMap = new Map<Estimate, { count: number; cycleTimes: number[] }>();
  for (const ticket of completed) {
    if (!estimateMap.has(ticket.estimate)) {
      estimateMap.set(ticket.estimate, { count: 0, cycleTimes: [] });
    }
    const entry = estimateMap.get(ticket.estimate)!;
    entry.count++;
    const implTime = findStatusEntryTime(ticket.id, "pending-implementation", audit);
    const resolvedAt = ticket.resolvedAt ? parseTs(ticket.resolvedAt) : null;
    if (implTime && resolvedAt) {
      entry.cycleTimes.push(
        msToHours(resolvedAt.getTime() - implTime.getTime())
      );
    }
  }

  const byEstimate: Partial<Record<Estimate, EstimateMetrics>> = {};
  for (const [estimate, data] of estimateMap.entries()) {
    const avgCycle =
      data.cycleTimes.length > 0
        ? data.cycleTimes.reduce((s, h) => s + h, 0) / data.cycleTimes.length
        : 0;
    byEstimate[estimate] = {
      estimate,
      count: data.count,
      avgActualCycleTimeHours: avgCycle,
      points: (ESTIMATE_POINTS[estimate] ?? 0) * data.count,
    };
  }

  // Blocked time: not tracked directly in current audit schema.
  // Placeholder — future: derive from explicit "blocked" status transitions.
  const avgBlockedTimeHours = 0;

  return {
    startDate,
    endDate,
    throughput: completed.length,
    avgCycleTimeHours,
    velocityPoints,
    avgBlockedTimeHours,
    estimationAccuracyPct,
    carryOverCount,
    carryOverPct,
    byTeam,
    byEstimate: byEstimate as Record<Estimate, EstimateMetrics>,
  };
}

/**
 * Compute throughput for each week in a rolling window.
 * Useful for plotting velocity trends over time.
 */
export function computeWeeklyThroughput(
  weeks: number,
  project?: string
): Array<{ weekStart: string; throughput: number; velocityPoints: number }> {
  const store = new TicketStore();
  const tickets = store.list(project ? { project } : {});

  const now = new Date();
  const results: Array<{ weekStart: string; throughput: number; velocityPoints: number }> = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 7);

    const completed = tickets.filter((t) => {
      if (!TERMINAL_STATUSES.includes(t.status)) return false;
      const resolvedAt = t.resolvedAt ? new Date(t.resolvedAt) : null;
      return resolvedAt && resolvedAt >= weekStart && resolvedAt <= weekEnd;
    });

    results.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      throughput: completed.length,
      velocityPoints: completed.reduce(
        (sum, t) => sum + (ESTIMATE_POINTS[t.estimate] ?? 0),
        0
      ),
    });
  }

  return results;
}
