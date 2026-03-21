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
  CounterStore,
  CreateTicketInput,
  UpdateTicketInput,
} from "./types.js";
import { getRepoPrefix } from "../repos.js";

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
    execSync(
      `flock -w 5 ${JSON.stringify(lockPath)} bash -c 'echo ${JSON.stringify(json)} >> ${JSON.stringify(auditPath)}'`
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
        team: ["", ticket.team],
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
      newStatus === "failed"
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
   * Add a comment to a ticket.
   */
  addComment(id: string, author: string, content: string): Ticket {
    const ticket = this.get(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);

    const now = new Date().toISOString();
    const comment = { author, content, timestamp: now };
    const updated: Ticket = {
      ...ticket,
      comments: [...ticket.comments, comment],
      updatedAt: now,
    };

    writeFileSync(this.ticketPath(id), JSON.stringify(updated, null, 2));

    this.appendAudit({
      ticket_id: id,
      action: "commented",
      actor: author,
      timestamp: now,
      changes: { comment: [null, content] },
    });

    return updated;
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
    team?: string;
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
      if (filters.team && t.team !== filters.team) return false;
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
