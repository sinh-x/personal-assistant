import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { Ticket, Comment, DocRef, SubTicket, LinkedBranch, LinkedCommit } from "./types.js";
import { formatDocRefBadge, deriveDocRefTitle } from "./doc-ref.js";

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
 * Format a doc_refs table — two-line layout per ref.
 * Line 1: badge + title (★ marks primary, aligned to first column)
 * Line 2: indented dim path
 */
export function formatDocRefsTable(docRefs: DocRef[]): string {
  if (docRefs.length === 0) return "  (none)";
  const COLORS = { dim: "\x1b[2m", reset: "\x1b[0m" };
  const rows: string[] = [];
  rows.push(`  DOC REFS`);
  rows.push(`  ${"-".repeat(74)}`);
  for (const ref of docRefs) {
    const badge = formatDocRefBadge(ref);
    const title = deriveDocRefTitle(ref);
    rows.push(
      `  ${badge} ${title}\n  ${COLORS.dim}${ref.path}${COLORS.reset}`
    );
  }
  return rows.join("\n");
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
 * Format sub-tickets section for display in ticket card.
 * Returns empty string if no sub-tickets exist.
 */
function formatSubTicketsSection(subTickets: SubTicket[]): string {
  if (!subTickets || subTickets.length === 0) return "";
  const statusBadge = (s: string) => {
    switch (s) {
      case "done": return "[done]";
      case "in-progress": return "[in-progress]";
      default: return "[open]";
    }
  };
  const header = "  ID".padEnd(20) + "STATUS".padEnd(16) + "PRI".padEnd(10) + "EST".padEnd(6) + "ASSIGNEE".padEnd(18) + "TITLE";
  const sep = "  " + "-".repeat(78);
  const rows = subTickets.map((st) =>
    "  " +
    st.id.padEnd(18) +
    statusBadge(st.status).padEnd(16) +
    st.priority.padEnd(10) +
    st.estimate.padEnd(6) +
    (st.assignee || "—").padEnd(18) +
    st.title
  );
  return [
    `  ── Sub-Tickets (${subTickets.length}) ──────────────────────────────────────`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

/**
 * Format linked branches section for display in ticket card.
 * Returns empty string if no linked branches exist.
 */
function formatLinkedBranchesSection(branches: LinkedBranch[]): string {
  if (!branches || branches.length === 0) return "";
  const header = "  REPO".padEnd(20) + "BRANCH".padEnd(35) + "SHA".padEnd(12) + "LINKED AT";
  const sep = "  " + "-".repeat(80);
  const rows = branches.map((b) => {
    const sha = b.sha ? b.sha.slice(0, 7) : "—";
    const date = b.linkedAt ? b.linkedAt.split("T")[0] : "—";
    return (
      "  " +
      b.repo.padEnd(18) +
      (b.branch.length > 33 ? b.branch.slice(0, 30) + "..." : b.branch).padEnd(35) +
      sha.padEnd(12) +
      date
    );
  });
  return [
    `  ── Linked Branches (${branches.length}) ─────────────────────────────────────`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

/**
 * Format linked commits section for display in ticket card.
 * Returns empty string if no linked commits exist.
 */
function formatLinkedCommitsSection(commits: LinkedCommit[]): string {
  if (!commits || commits.length === 0) return "";
  const header = "  REPO".padEnd(20) + "SHA".padEnd(12) + "AUTHOR".padEnd(18) + "DATE".padEnd(12) + "MESSAGE";
  const sep = "  " + "-".repeat(80);
  const rows = commits.map((c) => {
    const sha = c.sha ? c.sha.slice(0, 7) : "—";
    const date = c.timestamp ? c.timestamp.split("T")[0] : "—";
    const author = c.author || "—";
    const msg = c.message
      ? c.message.length > 30
        ? c.message.slice(0, 27) + "..."
        : c.message
      : "—";
    return (
      "  " +
      c.repo.padEnd(18) +
      sha.padEnd(12) +
      (author.length > 16 ? author.slice(0, 13) + "..." : author).padEnd(18) +
      date.padEnd(12) +
      msg
    );
  });
  return [
    `  ── Linked Commits (${commits.length}) ──────────────────────────────────────`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

/**
 * Format a Ticket object as a human-readable terminal card view.
 *
 * Renders: header bar, title, summary, description, doc_refs, sub-tickets, comments, metadata.
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
    ...((ticket.linkedBranches ?? []).length > 0
      ? [formatLinkedBranchesSection(ticket.linkedBranches ?? []), ""]
      : []),
    ...((ticket.linkedCommits ?? []).length > 0
      ? [formatLinkedCommitsSection(ticket.linkedCommits ?? []), ""]
      : []),
    ...((ticket.subTickets ?? []).length > 0
      ? [formatSubTicketsSection(ticket.subTickets ?? []), ""]
      : []),
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
