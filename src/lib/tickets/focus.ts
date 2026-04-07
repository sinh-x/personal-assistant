/**
 * GTD Focus System — Core library
 *
 * Provides buildFocusList() for generating prioritized cross-project focus views,
 * staleness detection, WIP summary, and AI suggestion enrichment.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TicketStore } from "./store.js";
import type { Ticket, TicketStatus, TicketPriority } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Slim ticket representation for focus view */
export interface FocusItem {
  id: string;
  title: string;
  project: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string;
  staleDays: number;
  isBlocked: boolean;
  blockerIds: string[];
  updatedAt: string;
}

/** WIP summary broken down by status and project */
export interface WipSummary {
  byStatus: Record<TicketStatus, number>;
  byProject: Record<string, number>;
  total: number;
}

/** AI suggestion from a cached focus report */
export interface Suggestion {
  action: string;
  reason: string;
  ticketId: string;
}

/** Result returned by buildFocusList */
export interface FocusResult {
  focus: FocusItem[];
  wip: WipSummary;
  suggestions?: Suggestion[];
  report_age_minutes?: number;
}

/** Filters for buildFocusList */
export interface FocusFilters {
  project?: string;
  assignee?: string;
  includeAll?: boolean; // --all flag: include idea and requirement-review stages
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Focus-relevant statuses (actionable items past the idea phase) */
const FOCUS_STATUSES: TicketStatus[] = [
  "pending-approval",
  "pending-implementation",
  "implementing",
  "review-uat",
];

/** Extended statuses when --all is passed */
const ALL_FOCUS_STATUSES: TicketStatus[] = [
  "idea",
  "requirement-review",
  ...FOCUS_STATUSES,
];

/** Staleness thresholds per status (days) */
const STALENESS_THRESHOLDS: Record<TicketStatus, number> = {
  "idea": 999,
  "requirement-review": 999,
  "pending-approval": 2,
  "pending-implementation": 3,
  "implementing": 5,
  "review-uat": 3,
  "done": 999,
  "rejected": 999,
  "cancelled": 999,
};

/** Priority sort order */
const PRIORITY_ORDER: Record<TicketPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Build the GTD focus list — tickets in actionable statuses,
 * sorted by priority then staleness, with WIP summary.
 *
 * @param filters - Optional filters: project, assignee, includeAll
 */
export function buildFocusList(filters: FocusFilters = {}): FocusResult {
  const store = new TicketStore();

  // List tickets excluding backlog/archived tags and fyi/work-report types
  const allTickets = store.list({
    project: filters.project,
    assignee: filters.assignee,
    excludeTags: ["backlog", "archived"],
    excludeTypes: ["fyi", "work-report"],
  });

  // Post-filter to focus statuses
  const relevantStatuses = filters.includeAll ? ALL_FOCUS_STATUSES : FOCUS_STATUSES;
  const focusTickets = allTickets.filter((t) => relevantStatuses.includes(t.status));

  // Build WIP summary from ALL focus tickets (before assignee filter for accurate counts)
  const wip = buildWipSummary(focusTickets);

  // Enrich each ticket into a FocusItem
  const focusItems: FocusItem[] = focusTickets.map((t) => enrichTicket(t));

  // Sort by priority then staleness (most stale first within priority)
  focusItems.sort((a, b) => {
    const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    // Most stale (highest days) first
    return b.staleDays - a.staleDays;
  });

  return { focus: focusItems, wip };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculate staleness in days for a ticket.
 */
export function calculateStaleness(ticket: Ticket): number {
  const threshold = STALENESS_THRESHOLDS[ticket.status] ?? 999;
  const updatedAt = new Date(ticket.updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - updatedAt.getTime();
  const days = Math.floor(diffMs / 86400000);
  return Math.max(0, days - threshold);
}

/**
 * Check if a ticket is stale (> threshold days since update).
 */
export function isTicketStale(ticket: Ticket): boolean {
  return calculateStaleness(ticket) > 0;
}

/**
 * Enrich a raw ticket into a FocusItem.
 */
function enrichTicket(ticket: Ticket): FocusItem {
  return {
    id: ticket.id,
    title: ticket.title,
    project: ticket.project,
    status: ticket.status,
    priority: ticket.priority,
    assignee: ticket.assignee,
    staleDays: calculateStaleness(ticket),
    isBlocked: ticket.tags.includes("blocked") || ticket.blockedBy.length > 0,
    blockerIds: ticket.blockedBy,
    updatedAt: ticket.updatedAt,
  };
}

/**
 * Build WIP summary from a list of tickets.
 */
function buildWipSummary(tickets: Ticket[]): WipSummary {
  const byStatus: Record<TicketStatus, number> = {
    "idea": 0,
    "requirement-review": 0,
    "pending-approval": 0,
    "pending-implementation": 0,
    "implementing": 0,
    "review-uat": 0,
    "done": 0,
    "rejected": 0,
    "cancelled": 0,
  };

  const byProject: Record<string, number> = {};

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byProject[t.project] = (byProject[t.project] ?? 0) + 1;
  }

  return { byStatus, byProject, total: tickets.length };
}

/**
 * Detect bottlenecks — projects with >3 items in late pipeline stages.
 */
export function detectBottlenecks(focusItems: FocusItem[]): Record<string, number> {
  const lateStatuses: TicketStatus[] = ["pending-approval", "pending-implementation", "implementing", "review-uat"];
  const byProject: Record<string, number> = {};

  for (const item of focusItems) {
    if (lateStatuses.includes(item.status)) {
      byProject[item.project] = (byProject[item.project] ?? 0) + 1;
    }
  }

  // Return only projects with >3 late items
  return Object.fromEntries(
    Object.entries(byProject).filter(([, count]) => count > 3)
  );
}

// ── Focus report reader ───────────────────────────────────────────────────────

/**
 * Read the latest cached focus report from agent-teams/requirements/artifacts/.
 * Returns null if no report exists yet.
 */
export function readLatestFocusReport(): {
  suggestions: Suggestion[];
  age_minutes: number;
} | null {
  const artifactsDir = join(homedir(), "Documents/ai-usage/agent-teams/requirements/artifacts");

  if (!existsSync(artifactsDir)) return null;

  // Find all focus-report-*.md files sorted by mtime descending
  let files: Array<{ name: string; mtime: Date }> = [];
  try {
    files = readdirSync(artifactsDir)
      .filter((f) => f.startsWith("focus-report-") && f.endsWith(".md"))
      .map((name) => {
        const { mtime } = require("node:fs").statSync(join(artifactsDir, name));
        return { name, mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  const latest = files[0];
  const reportPath = join(artifactsDir, latest.name);

  try {
    const content = readFileSync(reportPath, "utf-8");
    const suggestions = parseFocusReport(content);
    const now = new Date();
    const ageMs = now.getTime() - latest.mtime.getTime();
    const age_minutes = Math.floor(ageMs / 60000);
    return { suggestions, age_minutes };
  } catch {
    return null;
  }
}

/**
 * Parse a focus report markdown file to extract suggestions.
 * Looks for structured suggestion blocks per ticket.
 */
function parseFocusReport(content: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  // Match patterns like "**PA-042**: [action] - [reason]" or "**PA-042** — [suggestion]"
  const ticketIdPattern = /\*\*([A-Z]+-\d+)\*\*[:\s]+([^\n]+?)(?:\n|$)/g;
  let match;

  while ((match = ticketIdPattern.exec(content)) !== null) {
    const ticketId = match[1];
    const rest = match[2];
    // Try to split on " — " or " - " for action/reason
    const dashMatch = rest.match(/^(.+?)\s+[-—]\s+(.+)$/);
    if (dashMatch) {
      suggestions.push({
        ticketId,
        action: dashMatch[1].trim(),
        reason: dashMatch[2].trim(),
      });
    } else {
      suggestions.push({
        ticketId,
        action: rest.trim(),
        reason: "",
      });
    }
  }

  return suggestions;
}
