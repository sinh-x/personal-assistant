import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { Ticket, Comment, DocRef } from "./types.js";

// Configure marked with terminal renderer
const terminalRenderer = markedTerminal({
  width: process.stdout.isTTY ? process.stdout.columns : 80,
  reflowText: true,
});

marked.use(terminalRenderer);

/**
 * Render markdown content to ANSI terminal-formatted string.
 * Falls back to plain text if rendering fails.
 */
function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return marked.parse(content, { async: false }) as string;
  } catch {
    return content;
  }
}

/**
 * Format a relative or absolute timestamp for display.
 */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

/**
 * Format a doc_refs table — reused from ticket.ts show command.
 */
function formatDocRefsTable(docRefs: DocRef[]): string {
  if (docRefs.length === 0) return "  (none)";
  const width = process.stdout.isTTY ? Math.min(process.stdout.columns, 120) : 100;
  const typeWidth = 20;
  const pathWidth = width - typeWidth - 12;
  const header = "  TYPE".padEnd(typeWidth) + "PATH".padEnd(pathWidth) + "PRIMARY";
  const sep = "  " + "-".repeat(width);
  const rows = docRefs.map((r) =>
    "  " +
    r.type.padEnd(typeWidth - 2) +
    (r.path.length > pathWidth - 3
      ? r.path.slice(0, pathWidth - 6) + "..."
      : r.path).padEnd(pathWidth - 2) +
    (r.primary ? "✓" : "")
  );
  return [header, sep, ...rows].join("\n");
}

/**
 * Format a single comment for display.
 */
function formatComment(comment: Comment): string {
  const edited = comment.editedAt ? " [edited]" : "";
  const meta = `  ▶ ${comment.author} (${formatTimestamp(comment.timestamp)})${edited}`;
  const content = renderMarkdown(comment.content);
  return `${meta}\n${content.split("\n").map((l) => (l ? `   ${l}` : "")).join("\n")}`;
}

/**
 * Format the metadata section of a ticket card.
 */
function formatMetadata(ticket: Ticket): string {
  const lines: string[] = [];
  lines.push(`  Created: ${formatTimestamp(ticket.createdAt)}`);
  lines.push(`  Updated: ${formatTimestamp(ticket.updatedAt)}`);
  if (ticket.resolvedAt) {
    lines.push(`  Resolved: ${formatTimestamp(ticket.resolvedAt)}`);
  }
  if (ticket.assignee) {
    lines.push(`  Assignee: ${ticket.assignee}`);
  }
  if (ticket.tags.length > 0) {
    lines.push(`  Tags: ${ticket.tags.join(", ")}`);
  }
  if (ticket.blockedBy.length > 0) {
    lines.push(`  Blocked by: ${ticket.blockedBy.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Format a Ticket object as a human-readable terminal card view.
 *
 * Renders: header bar, title, summary, description, doc_refs, comments, metadata.
 * Uses `marked` + `marked-terminal` for markdown rendering with ANSI formatting.
 * Gracefully handles malformed markdown by falling back to plain text.
 */
export function formatTicketCard(ticket: Ticket): string {
  const width = process.stdout.isTTY ? Math.min(process.stdout.columns, 120) : 100;
  const sep = "─".repeat(width);

  // Header bar: ID | status | priority | estimate
  const header = `${ticket.id} │ ${ticket.status} │ ${ticket.priority} │ ${ticket.estimate}`;

  // Tags and blockedBy summary line
  const tags = ticket.tags.length > 0 ? ticket.tags.join(", ") : "—";
  const blockedBy = ticket.blockedBy.length > 0 ? ticket.blockedBy.join(", ") : "—";
  const assignLine = `Assignee: ${ticket.assignee || "—"} │ Tags: ${tags} │ Blocked by: ${blockedBy}`;

  // Rendered content
  const summaryRendered = ticket.summary ? renderMarkdown(ticket.summary) : "(none)";
  const descriptionRendered = ticket.description ? renderMarkdown(ticket.description) : "(none)";

  // Comments
  const commentsSection =
    ticket.comments.length === 0
      ? "  (none)"
      : ticket.comments.map((c) => formatComment(c)).join("\n\n");

  const parts: string[] = [
    header,
    assignLine,
    sep,
    "",
    `  ${ticket.title}`,
    "",
    `  ── Summary ──────────────────────────────────────────────`,
    "",
    summaryRendered
      .split("\n")
      .map((l) => (l ? `  ${l}` : ""))
      .join("\n"),
    "",
    `  ── Description ──────────────────────────────────────────`,
    "",
    descriptionRendered
      .split("\n")
      .map((l) => (l ? `  ${l}` : ""))
      .join("\n"),
    "",
    `  ── Document References ──────────────────────────────────`,
    "",
    formatDocRefsTable(ticket.doc_refs),
    "",
    `  ── Comments (${ticket.comments.length}) ────────────────────────────────────────`,
    "",
    commentsSection,
    "",
    `  ── Metadata ─────────────────────────────────────────────`,
    "",
    formatMetadata(ticket),
  ];

  return parts.join("\n");
}
