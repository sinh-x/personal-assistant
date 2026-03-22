import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { getTicketsDir } from "../paths.js";
import type {
  Ticket,
  AuditEntry,
  Comment,
  CounterStore,
  CreateTicketInput,
  UpdateTicketInput,
} from "./types.js";
import { ACTIVE_STATUSES } from "./types.js";
import { getRepoPrefix } from "../repos.js";

/** Pipeline stage order for handoff warning — higher index = later stage */
const PIPELINE_ORDER: Record<string, number> = {
  "idea": 0,
  "requirement-review": 1,
  "pending-approval": 2,
  "pending-implementation": 3,
  "implementing": 4,
  "review-uat": 5,
  "done": 6,
  "rejected": 6,
  "cancelled": 6,
  // on-hold is intentionally omitted — parking is not a pipeline advance
};

/** All valid statuses in display order */
const ALL_VALID_STATUSES = [...ACTIVE_STATUSES, "done", "rejected", "on-hold", "cancelled"];

/**
 * TicketStore — manages all ticket CRUD operations with flock locking.
 *
 * Storage layout (flat — all tickets in one directory, project is a field):
 *   ~/Documents/ai-usage/tickets/
 *     counter.json       — {"PA": 3, "NX": 1} (next number per prefix)
 *     audit.jsonl        — append-only mutation log
 *     .tickets.lock      — flock lock file
 *   Prefixes come from repos.yaml (prefix: field on each repo entry)
 *     PA-001.json        — ticket files
 *     NX-001.json
 */
export class TicketStore {
  private readonly dir: string;
  private readonly lockPath: string;

  constructor() {
    this.dir = getTicketsDir();
    this.lockPath = resolve(this.dir, ".tickets.lock");
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.lockPath)) writeFileSync(this.lockPath, "");
  }

  private ticketPath(id: string): string {
    return resolve(this.dir, `${id}.json`);
  }

  private counterPath(): string {
    return resolve(this.dir, "counter.json");
  }

  private auditPath(): string {
    return resolve(this.dir, "audit.jsonl");
  }

  // ── ID allocation ─────────────────────────────────────────────────────────

  /**
   * Allocate the next ticket ID for a prefix atomically under flock.
   * Reads counter.json, increments the prefix counter, writes back, returns the new ID.
   * Uses a temp file to avoid newline escaping issues with node -e on Node.js 22.
   */
  private allocateId(prefix: string): string {
    const counterPath = this.counterPath();
    const lockPath = this.lockPath;

    // Write script to a temp file so newlines are preserved correctly
    const script = [
      "const fs = require('fs');",
      `const cp = ${JSON.stringify(counterPath)};`,
      `const pfx = ${JSON.stringify(prefix)};`,
      "const counters = fs.existsSync(cp) ? JSON.parse(fs.readFileSync(cp, 'utf8')) : {};",
      "const next = (counters[pfx] || 0) + 1;",
      "counters[pfx] = next;",
      "fs.writeFileSync(cp, JSON.stringify(counters, null, 2));",
      "process.stdout.write(String(next));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-counter-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(tmpFile, script);

    try {
      const result = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      )
        .toString()
        .trim();

      const num = parseInt(result, 10);
      return `${prefix}-${String(num).padStart(3, "0")}`;
    } finally {
      try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
    }
  }

  // ── Project prefix (from repos.yaml) ───────────────────────────────────────

  /** Get the ticket prefix for a project name from repos.yaml. */
  getPrefix(projectName: string): string | undefined {
    return getRepoPrefix(projectName);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  /** Append one entry to audit.jsonl under flock. */
  private appendAudit(entry: AuditEntry): void {
    const auditPath = this.auditPath();
    const lockPath = this.lockPath;
    const json = JSON.stringify(entry);
    // Pass content via env var to avoid shell quoting issues with special chars (apostrophes, quotes, etc.)
    execSync(
      `flock -w 5 ${JSON.stringify(lockPath)} bash -c 'printf "%s\\n" "$_AUDIT_ENTRY" >> ${JSON.stringify(auditPath)}'`,
      { env: { ...process.env, _AUDIT_ENTRY: json } }
    );
  }

  /** Read all audit entries from audit.jsonl. */
  readAudit(): AuditEntry[] {
    const path = this.auditPath();
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuditEntry);
  }

  /** Read audit entries for a specific ticket. */
  getTicketAudit(ticketId: string): AuditEntry[] {
    return this.readAudit().filter((e) => e.ticket_id === ticketId);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Create a new ticket.
   * - Requires a registered project prefix (or pass prefix directly).
   * - Allocates the next sequential ID atomically.
   * - Appends an audit entry.
   */
  create(input: CreateTicketInput, actor: string): Ticket {
    const prefix = this.getPrefix(input.project);
    if (!prefix) {
      throw new Error(
        `Unknown project "${input.project}". Register it first with registerProject().`
      );
    }

    const id = this.allocateId(prefix);
    const now = new Date().toISOString();

    const ticket: Ticket = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      resolvedAt: input.resolvedAt ?? null,
    };

    writeFileSync(this.ticketPath(id), JSON.stringify(ticket, null, 2));

    this.appendAudit({
      ticket_id: id,
      action: "created",
      actor,
      timestamp: now,
      changes: {
        status: ["", ticket.status],
        assignee: ["", ticket.assignee],
        estimate: ["", ticket.estimate],
        priority: ["", ticket.priority],
      },
    });

    return ticket;
  }

  /**
   * Get a ticket by ID. Returns undefined if not found.
   */
  get(id: string): Ticket | undefined {
    const path = this.ticketPath(id);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as Ticket;
  }

  /**
   * Update fields on an existing ticket.
   * Records all changed fields in the audit log.
   */
  update(id: string, input: UpdateTicketInput, actor: string): Ticket {
    const ticket = this.get(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);

    // Step 1: Reject unknown statuses
    if (input.status !== undefined && !ALL_VALID_STATUSES.includes(input.status)) {
      throw new Error(
        `Invalid status '${input.status}'. Valid statuses: ${ALL_VALID_STATUSES.join(", ")}`
      );
    }

    // Step 0: Warn when advancing pipeline stage without setting assignee
    if (input.status !== undefined && !input.assignee) {
      const oldPos = PIPELINE_ORDER[ticket.status] ?? -1;
      const newPos = PIPELINE_ORDER[input.status] ?? -1;
      if (newPos > oldPos) {
        process.stderr.write(
          "Warning: Status advanced without setting team/assignee — ticket may be orphaned\n"
        );
      }
    }

    // Step 0b: Warn when advancing to a review gate without doc_ref
    if (
      (input.status === "pending-approval" || input.status === "review-uat") &&
      !input.doc_ref &&
      !ticket.doc_ref
    ) {
      process.stderr.write(
        `Warning: Advancing to ${input.status} without doc_ref — ticket may lack review context\n`
      );
      // Inject needs-doc-ref tag (additive — preserves existing tags)
      const existingTags = input.tags ?? ticket.tags ?? [];
      if (!existingTags.includes("needs-doc-ref")) {
        input.tags = [...existingTags, "needs-doc-ref"];
      }
    }

    const now = new Date().toISOString();
    const changes: Record<string, [unknown, unknown]> = {};

    for (const [key, newVal] of Object.entries(input)) {
      const oldVal = ticket[key as keyof Ticket];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes[key] = [oldVal, newVal];
      }
    }

    // Set resolvedAt when moving to a terminal status
    const newStatus = input.status;
    if (
      newStatus === "done" ||
      newStatus === "rejected" ||
      newStatus === "cancelled"
    ) {
      if (!ticket.resolvedAt) {
        changes["resolvedAt"] = [null, now];
        (input as Record<string, unknown>)["resolvedAt"] = now;
      }
    }

    const updated: Ticket = { ...ticket, ...input, updatedAt: now };
    writeFileSync(this.ticketPath(id), JSON.stringify(updated, null, 2));

    if (Object.keys(changes).length > 0) {
      this.appendAudit({
        ticket_id: id,
        action: "updated",
        actor,
        timestamp: now,
        changes,
      });
    }

    return updated;
  }

  /**
   * Add a comment to a ticket atomically (flock-protected).
   * Generates a UUID for the new comment.
   * Returns the updated ticket and the created comment.
   */
  addComment(id: string, author: string, content: string): { ticket: Ticket; comment: Comment } {
    if (!this.get(id)) throw new Error(`Ticket not found: ${id}`);

    const ticketPath = this.ticketPath(id);
    const lockPath = this.lockPath;
    const now = new Date().toISOString();
    const commentId = crypto.randomUUID();
    const comment: Comment = { id: commentId, author, content, timestamp: now };

    const script = [
      "const fs = require('fs');",
      `const tp = ${JSON.stringify(ticketPath)};`,
      `const comment = ${JSON.stringify(comment)};`,
      `const now = ${JSON.stringify(now)};`,
      "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
      "ticket.comments = [...ticket.comments, comment];",
      "ticket.updatedAt = now;",
      "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      "process.stdout.write(JSON.stringify(ticket));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-comment-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(tmpFile, script);

    let updatedTicket: Ticket;
    try {
      const result = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      ).toString();
      updatedTicket = JSON.parse(result) as Ticket;
    } finally {
      try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
    }

    this.appendAudit({
      ticket_id: id,
      action: "commented",
      actor: author,
      timestamp: now,
      changes: { comment: [null, content] },
    });

    return { ticket: updatedTicket, comment };
  }

  /**
   * Edit an existing comment on a ticket atomically (flock-protected).
   * Updates content and sets editedAt timestamp.
   * Returns the updated ticket and the edited comment.
   */
  editComment(id: string, commentId: string, content: string, actor?: string): { ticket: Ticket; comment: Comment } {
    if (!this.get(id)) throw new Error(`Ticket not found: ${id}`);

    const ticketPath = this.ticketPath(id);
    const lockPath = this.lockPath;
    const now = new Date().toISOString();

    const script = [
      "const fs = require('fs');",
      `const tp = ${JSON.stringify(ticketPath)};`,
      `const commentId = ${JSON.stringify(commentId)};`,
      `const newContent = ${JSON.stringify(content)};`,
      `const now = ${JSON.stringify(now)};`,
      "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
      "const idx = ticket.comments.findIndex(c => c.id === commentId);",
      "if (idx === -1) { process.stderr.write('Comment not found\\n'); process.exit(2); }",
      "ticket.comments[idx].content = newContent;",
      "ticket.comments[idx].editedAt = now;",
      "ticket.updatedAt = now;",
      "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      "process.stdout.write(JSON.stringify({ ticket, comment: ticket.comments[idx] }));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-edit-comment-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(tmpFile, script);

    let result: { ticket: Ticket; comment: Comment };
    try {
      const raw = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      ).toString();
      result = JSON.parse(raw) as { ticket: Ticket; comment: Comment };
    } finally {
      try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
    }

    this.appendAudit({
      ticket_id: id,
      action: "comment_edited",
      actor: actor ?? "unknown",
      timestamp: now,
      changes: { commentId: [commentId, commentId], content: [null, content] },
    });

    return result;
  }

  /**
   * Delete a comment from a ticket atomically (flock-protected).
   * Returns the updated ticket.
   */
  deleteComment(id: string, commentId: string, actor?: string): Ticket {
    if (!this.get(id)) throw new Error(`Ticket not found: ${id}`);

    const ticketPath = this.ticketPath(id);
    const lockPath = this.lockPath;
    const now = new Date().toISOString();

    const script = [
      "const fs = require('fs');",
      `const tp = ${JSON.stringify(ticketPath)};`,
      `const commentId = ${JSON.stringify(commentId)};`,
      `const now = ${JSON.stringify(now)};`,
      "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
      "const exists = ticket.comments.some(c => c.id === commentId);",
      "if (!exists) { process.stderr.write('Comment not found\\n'); process.exit(2); }",
      "ticket.comments = ticket.comments.filter(c => c.id !== commentId);",
      "ticket.updatedAt = now;",
      "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      "process.stdout.write(JSON.stringify(ticket));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-del-comment-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(tmpFile, script);

    let updatedTicket: Ticket;
    try {
      const raw = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      ).toString();
      updatedTicket = JSON.parse(raw) as Ticket;
    } finally {
      try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
    }

    this.appendAudit({
      ticket_id: id,
      action: "comment_deleted",
      actor: actor ?? "unknown",
      timestamp: now,
      changes: { commentId: [commentId, null] },
    });

    return updatedTicket;
  }

  /**
   * Attach a file or doc_ref to a ticket.
   */
  attach(id: string, attachment: string, actor: string): Ticket {
    const ticket = this.get(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);

    const now = new Date().toISOString();
    const updated: Ticket = {
      ...ticket,
      attachments: [...ticket.attachments, attachment],
      updatedAt: now,
    };

    writeFileSync(this.ticketPath(id), JSON.stringify(updated, null, 2));

    this.appendAudit({
      ticket_id: id,
      action: "attached",
      actor,
      timestamp: now,
      changes: { attachment: [null, attachment] },
    });

    return updated;
  }

  // ── Listing & filtering ───────────────────────────────────────────────────

  /**
   * List all tickets, optionally filtered.
   */
  list(filters: {
    project?: string;
    status?: string;
    assignee?: string;
    priority?: string;
    type?: string;
    tags?: string[];
  } = {}): Ticket[] {
    const files = readdirSync(this.dir).filter(
      (f) => f.endsWith(".json") && f !== "counter.json"
    );

    const tickets = files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(resolve(this.dir, f), "utf-8")) as Ticket;
        } catch {
          return null;
        }
      })
      .filter((t): t is Ticket => t !== null);

    return tickets.filter((t) => {
      if (filters.project && t.project !== filters.project) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.assignee && t.assignee !== filters.assignee) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.tags?.length) {
        if (!filters.tags.every((tag) => t.tags.includes(tag))) return false;
      }
      return true;
    });
  }

  /** Read the current counter state. */
  readCounters(): CounterStore {
    const path = this.counterPath();
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf-8")) as CounterStore)
      : {};
  }
}
