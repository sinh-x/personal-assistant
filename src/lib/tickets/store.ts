import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { getTicketsDir } from "../paths.js";
import { normalizeSandboxPath } from "../agent-api/utils/sandbox.js";
import { matchAssignee } from "./validate.js";
import type {
  Ticket,
  DocRef,
  AuditEntry,
  Comment,
  CounterStore,
  CreateTicketInput,
  UpdateTicketInput,
  AddDocRefInput,
  AliasRecord,
  SubTicket,
  SubTicketStatus,
  TicketStatus,
  TicketType,
  TicketPriority,
  Estimate,
} from "./types.js";
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from "./types.js";
import { resolveProject } from "../repos.js";

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
};

/** All valid statuses in display order */
const ALL_VALID_STATUSES = [...ACTIVE_STATUSES, "done", "rejected", "cancelled"];

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

  /**
   * Normalize a raw ticket object from disk, ensuring all fields have safe defaults.
   * Only adds defaults for missing/null fields — never overwrites existing values.
   */
  private normalizeTicket(raw: Record<string, unknown>): Ticket {
    // Warn if id is missing (should always exist)
    if (!raw.id) {
      process.stderr.write(`Warning: Ticket missing 'id' field — please repair the ticket file\n`);
    }

    return {
      ...raw,
      // Scalar fields with defaults
      id: raw.id as string ?? "(unknown)",
      project: (raw.project as string) ?? "unknown",
      title: (raw.title as string) ?? "(untitled)",
      summary: (raw.summary as string) ?? "",
      description: (raw.description as string) ?? "",
      status: (raw.status as TicketStatus) ?? "idea",
      priority: (raw.priority as TicketPriority) ?? "medium",
      type: (raw.type as TicketType) ?? "task",
      estimate: (raw.estimate as Estimate) ?? "M",
      from: (raw.from as string) ?? "",
      to: (raw.to as string) ?? "",
      createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
      updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
      resolvedAt: raw.resolvedAt !== undefined ? (raw.resolvedAt as string | null) : null,
      // Array fields with defaults
      tags: raw.tags ?? [],
      blockedBy: raw.blockedBy ?? [],
      comments: raw.comments ?? [],
      doc_refs: raw.doc_refs ?? [],
      assignee: (raw.assignee as string) ?? "",
      subTickets: raw.subTickets ?? [],
      nextSubTicketCounter: (raw.nextSubTicketCounter as number) ?? 0,
    } as Ticket;
  }

  private counterPath(): string {
    return resolve(this.dir, "counter.json");
  }

  private auditPath(): string {
    return resolve(this.dir, "audit.jsonl");
  }

  // ── Doc-ref helpers ───────────────────────────────────────────────────────

  /** Format a relative date for display in artifact suggestions. */
  private relativeDate(mtime: Date): string {
    const diffDays = Math.floor((Date.now() - mtime.getTime()) / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    return `${diffDays} days ago`;
  }

  /** Scan workspace for candidate artifact .md files, sorted by recency. */
  private suggestArtifacts(assignee: string, limit = 3): Array<{ path: string; mtime: Date }> {
    const aiUsageDir = join(homedir(), "Documents/ai-usage");
    const candidates: Array<{ path: string; mtime: Date }> = [];

    const scanDir = (dir: string) => {
      try {
        if (!existsSync(dir)) return;
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".md")) continue;
          const full = join(dir, f);
          try {
            const stat = statSync(full);
            if (stat.isFile()) {
              candidates.push({ path: full.replace(aiUsageDir + "/", ""), mtime: stat.mtime });
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    };

    // Scan agent-teams/*/artifacts/
    const agentTeamsDir = join(aiUsageDir, "agent-teams");
    try {
      if (existsSync(agentTeamsDir)) {
        for (const team of readdirSync(agentTeamsDir)) {
          scanDir(join(agentTeamsDir, team, "artifacts"));
        }
      }
    } catch { /* ignore */ }

    // Scan recent deployments/ for .md files
    const deploymentsDir = join(aiUsageDir, "deployments");
    try {
      if (existsSync(deploymentsDir)) {
        for (const d of readdirSync(deploymentsDir)) {
          if (d.startsWith(".")) continue;
          const dp = join(deploymentsDir, d);
          try {
            if (statSync(dp).isDirectory()) scanDir(dp);
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    // Deduplicate, sort by mtime desc, take top N
    const seen = new Set<string>();
    const unique: Array<{ path: string; mtime: Date }> = [];
    for (const c of candidates) {
      if (!seen.has(c.path)) { seen.add(c.path); unique.push(c); }
    }
    return unique.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limit);
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
    try {
      return resolveProject(projectName).prefix;
    } catch {
      return undefined;
    }
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
    const resolved = resolveProject(input.project);
    const { key: canonicalKey, prefix } = resolved;

    const id = this.allocateId(prefix);
    const now = new Date().toISOString();

    // F6: Dedup guard — deduplicate doc_refs by path (keep last entry per path)
    const dedupedDocRefs: DocRef[] = [];
    const seenPaths = new Set<string>();
    for (const ref of [...input.doc_refs].reverse()) {
      if (!seenPaths.has(ref.path)) {
        seenPaths.add(ref.path);
        dedupedDocRefs.unshift(ref);
      }
    }

    const ticket: Ticket = {
      ...input,
      project: canonicalKey,
      id,
      subTickets: [],
      nextSubTicketCounter: 0,
      createdAt: now,
      updatedAt: now,
      resolvedAt: input.resolvedAt ?? null,
      doc_refs: dedupedDocRefs,
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

    // F1: Remind about doc_ref for types that benefit from review context
    const typesNeedingDocRef = ["task", "feature", "review-request"];
    if (typesNeedingDocRef.includes(ticket.type) && ticket.doc_refs.length === 0) {
      process.stderr.write("Reminder: Consider attaching --doc-ref for review context\n");
    }

    return ticket;
  }

  /**
   * Get a ticket by ID. Returns undefined if not found.
   * Follows alias redirects transparently.
   */
  get(id: string): Ticket | undefined {
    const path = this.ticketPath(id);
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, "utf-8"));

    // Check if this is an alias file — follow the redirect
    if (raw._alias === true && typeof raw.movedTo === "string") {
      return this.get(raw.movedTo);
    }

    return this.normalizeTicket(raw);
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

    // Step 1b: Block done status if open sub-tickets exist
    if (input.status === "done" && (ticket.subTickets ?? []).length > 0) {
      const openSubs = (ticket.subTickets ?? []).filter(
        (st) => st.status !== "done"
      );
      if (openSubs.length > 0) {
        const ids = openSubs.map((st) => `${st.id} (${st.status})`).join(", ");
        throw new Error(
          `Cannot mark ${id} as done — ${openSubs.length} sub-ticket(s) still open: ${ids}. Complete all sub-tickets first.`
        );
      }
    }

    // Step 0: Warn when advancing pipeline stage without setting assignee
    if (input.status !== undefined && !input.assignee) {
      const oldPos = PIPELINE_ORDER[ticket.status] ?? -1;
      const newPos = PIPELINE_ORDER[input.status] ?? -1;
      if (newPos > oldPos) {
        process.stderr.write(
          "Warning: Status advanced without setting assignee — ticket may be orphaned\n"
        );
      }
    }

    // Extract special doc_ref operation fields (not spread into ticket data)
    const addDocRefInput: AddDocRefInput | undefined = (input as Record<string, unknown>).add_doc_ref as AddDocRefInput | undefined;
    const removeDocRefPath: string | undefined = (input as Record<string, unknown>).remove_doc_ref as string | undefined;
    const { add_doc_ref: _addDocRef, remove_doc_ref: _removeDocRef, ...restInput } = input as Record<string, unknown>;

    const hasDocRefs = (ticket.doc_refs?.length ?? 0) > 0 || !!addDocRefInput;

    // Step 0b: Warn when advancing to a review gate without doc_refs
    if (
      (input.status === "pending-approval" || input.status === "review-uat") &&
      !hasDocRefs
    ) {
      process.stderr.write(
        `Warning: Advancing to ${input.status} without doc_ref — ticket may lack review context\n`
      );
      // Inject needs-doc-ref tag (additive — preserves existing tags)
      const existingTags = (restInput.tags as string[] | undefined) ?? ticket.tags ?? [];
      if (!existingTags.includes("needs-doc-ref")) {
        restInput.tags = [...existingTags, "needs-doc-ref"];
      }
    }

    // Step 0c: Remind + suggest artifacts for ANY status advancement without doc_refs (F2, F3)
    if (input.status !== undefined) {
      const oldPos = PIPELINE_ORDER[ticket.status] ?? -1;
      const newPos = PIPELINE_ORDER[input.status] ?? -1;
      if (newPos > oldPos && !hasDocRefs) {
        process.stderr.write("Reminder: doc_ref not set. Consider attaching a document for review context.\n");
        const suggestions = this.suggestArtifacts((restInput.assignee as string | undefined) ?? ticket.assignee);
        if (suggestions.length > 0) {
          let msg = "Suggested artifacts:\n";
          suggestions.forEach((s, i) => { msg += `  ${i + 1}. ${s.path} (${this.relativeDate(s.mtime)})\n`; });
          msg += `Attach with: pa ticket update ${id} --doc-ref <path>\n`;
          process.stderr.write(msg);
        }
      }
    }

    const now = new Date().toISOString();
    const changes: Record<string, [unknown, unknown]> = {};

    for (const [key, newVal] of Object.entries(restInput)) {
      const oldVal = ticket[key as keyof Ticket];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes[key] = [oldVal, newVal];
      }
    }

    // Set resolvedAt when moving to a terminal status
    const newStatus = restInput.status as string | undefined;
    if (
      newStatus === "done" ||
      newStatus === "rejected" ||
      newStatus === "cancelled"
    ) {
      if (!ticket.resolvedAt) {
        changes["resolvedAt"] = [null, now];
        restInput["resolvedAt"] = now;
      }
    }

    // Auto-manage `blocked` tag based on blockedBy field changes
    const blockedByInput = restInput.blockedBy as string[] | undefined;
    if (blockedByInput !== undefined) {
      const currentTags: string[] = (restInput.tags as string[] | undefined) ?? ticket.tags ?? [];
      const hasBlockedBy = blockedByInput.length > 0;
      const hasTag = currentTags.includes("blocked");
      if (hasBlockedBy && !hasTag) {
        restInput.tags = [...currentTags, "blocked"];
      } else if (!hasBlockedBy && hasTag) {
        restInput.tags = currentTags.filter((t) => t !== "blocked");
      }
    }

    // Process doc_ref mutations
    let docRefs: DocRef[] = ticket.doc_refs ?? [];

    if (removeDocRefPath) {
      const before = docRefs;
      docRefs = docRefs.filter((r) => r.path !== removeDocRefPath);
      if (docRefs.length !== before.length) {
        changes["doc_refs"] = [before, docRefs];
        this.appendAudit({
          ticket_id: id,
          action: "doc_ref_removed",
          actor,
          timestamp: now,
          changes: { doc_ref: [removeDocRefPath, null] },
        });
      }
    }

    if (addDocRefInput) {
      const existingIdx = docRefs.findIndex((r) => r.path === addDocRefInput.path);
      const newRef: DocRef = {
        type: addDocRefInput.type ?? "attachment",
        path: addDocRefInput.path,
        primary: addDocRefInput.primary ?? false,
        addedAt: now,
        addedBy: addDocRefInput.addedBy ?? actor,
      };

      if (existingIdx >= 0) {
        // Upsert path — existing doc_ref found at same path
        const oldRef = docRefs[existingIdx];
        // If new ref is primary, demote any existing primary
        if (newRef.primary) {
          docRefs = docRefs.map((r) => ({ ...r, primary: false }));
        }
        // Replace the matched entry with updated values
        docRefs = docRefs.map((r, i) => (i === existingIdx ? { ...r, ...newRef } : r));
        const before = ticket.doc_refs ?? [];
        changes["doc_refs"] = [before, docRefs];
        process.stderr.write(`Info: doc_ref '${addDocRefInput.path}' already exists — updated in place\n`);
        this.appendAudit({
          ticket_id: id,
          action: "doc_ref_updated",
          actor,
          timestamp: now,
          changes: { doc_ref: [oldRef, newRef] },
        });
      } else {
        // Append path — no existing doc_ref with this path
        // Demote existing primary if the new one is primary
        if (newRef.primary) {
          docRefs = docRefs.map((r) => ({ ...r, primary: false }));
        }
        const before = ticket.doc_refs ?? [];

        // F1: Soft-enforcement — warn if referenced file does not exist (skip for URLs)
        const isUrl = newRef.path.startsWith("http://") || newRef.path.startsWith("https://");
        if (!isUrl) {
          const fullPath = normalizeSandboxPath(newRef.path);
          if (!existsSync(fullPath)) {
            process.stderr.write(`Warning: doc_ref path does not exist: ${newRef.path}\n`);
          }
        }

        docRefs = [...docRefs, newRef];
        changes["doc_refs"] = [before, docRefs];
        this.appendAudit({
          ticket_id: id,
          action: "doc_ref_added",
          actor,
          timestamp: now,
          changes: { doc_ref: [null, newRef] },
        });
      }
    }

    const updated: Ticket = { ...ticket, ...(restInput as Partial<Ticket>), doc_refs: docRefs, updatedAt: now };
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
   * Attach a file or doc_ref to a ticket (adds a DocRef with type: 'attachment').
   * Delegates to the additive doc_ref update path.
   */
  attach(id: string, attachment: string, actor: string): Ticket {
    return this.update(id, { add_doc_ref: { type: "attachment", path: attachment } }, actor);
  }

  // ── Sub-ticket operations ────────────────────────────────────────────────

  /**
   * Add a sub-ticket to a parent ticket atomically (flock-protected).
   * Auto-generates the sub-ticket ID from the parent's counter.
   */
  addSubTicket(
    parentId: string,
    input: { title: string; summary: string; assignee: string; priority: TicketPriority; estimate: Estimate },
    actor: string
  ): { ticket: Ticket; subTicket: SubTicket } {
    const ticket = this.get(parentId);
    if (!ticket) throw new Error(`Ticket not found: ${parentId}`);

    const now = new Date().toISOString();
    const counter = (ticket.nextSubTicketCounter ?? 0) + 1;
    const subTicketId = `${parentId}-ST-${counter}`;

    const subTicket: SubTicket = {
      id: subTicketId,
      title: input.title,
      summary: input.summary,
      status: "open",
      assignee: input.assignee,
      priority: input.priority,
      estimate: input.estimate,
      createdAt: now,
      updatedAt: now,
    };

    const ticketPath = this.ticketPath(parentId);
    const lockPath = this.lockPath;

    const script = [
      "const fs = require('fs');",
      `const tp = ${JSON.stringify(ticketPath)};`,
      `const subTicket = ${JSON.stringify(subTicket)};`,
      `const counter = ${JSON.stringify(counter)};`,
      `const now = ${JSON.stringify(now)};`,
      "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
      "if (!ticket.subTickets) ticket.subTickets = [];",
      "ticket.subTickets.push(subTicket);",
      "ticket.nextSubTicketCounter = counter;",
      "ticket.updatedAt = now;",
      "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      "process.stdout.write(JSON.stringify(ticket));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-subticket-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
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
      ticket_id: parentId,
      action: "updated",
      actor,
      timestamp: now,
      changes: { subTickets: [null, subTicket] },
    });

    return { ticket: this.normalizeTicket(updatedTicket as unknown as Record<string, unknown>), subTicket };
  }

  /**
   * Update fields on an existing sub-ticket atomically (flock-protected).
   */
  updateSubTicket(
    parentId: string,
    subTicketId: string,
    input: { status?: SubTicketStatus; assignee?: string; title?: string; summary?: string; priority?: TicketPriority; estimate?: Estimate },
    actor: string
  ): { ticket: Ticket; subTicket: SubTicket } {
    const ticket = this.get(parentId);
    if (!ticket) throw new Error(`Ticket not found: ${parentId}`);

    const subIdx = (ticket.subTickets ?? []).findIndex((st) => st.id === subTicketId);
    if (subIdx === -1) throw new Error(`Sub-ticket not found: ${subTicketId} on ${parentId}`);

    const now = new Date().toISOString();
    const oldSub = ticket.subTickets[subIdx];

    const ticketPath = this.ticketPath(parentId);
    const lockPath = this.lockPath;

    const script = [
      "const fs = require('fs');",
      `const tp = ${JSON.stringify(ticketPath)};`,
      `const subTicketId = ${JSON.stringify(subTicketId)};`,
      `const updates = ${JSON.stringify(input)};`,
      `const now = ${JSON.stringify(now)};`,
      "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
      "const idx = (ticket.subTickets || []).findIndex(st => st.id === subTicketId);",
      "if (idx === -1) { process.stderr.write('Sub-ticket not found\\n'); process.exit(2); }",
      "Object.assign(ticket.subTickets[idx], updates, { updatedAt: now });",
      "ticket.updatedAt = now;",
      "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      "process.stdout.write(JSON.stringify({ ticket, subTicket: ticket.subTickets[idx] }));",
    ].join("\n");

    const tmpFile = resolve(tmpdir(), `pa-subticket-upd-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(tmpFile, script);

    let result: { ticket: Ticket; subTicket: SubTicket };
    try {
      const raw = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      ).toString();
      result = JSON.parse(raw) as { ticket: Ticket; subTicket: SubTicket };
    } finally {
      try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
    }

    const changes: Record<string, [unknown, unknown]> = {};
    for (const [key, val] of Object.entries(input)) {
      if (val !== undefined) {
        changes[`subTicket.${key}`] = [oldSub[key as keyof SubTicket], val];
      }
    }

    this.appendAudit({
      ticket_id: parentId,
      action: "updated",
      actor,
      timestamp: now,
      changes: { subTicketId: [subTicketId, subTicketId], ...changes },
    });

    return {
      ticket: this.normalizeTicket(result.ticket as unknown as Record<string, unknown>),
      subTicket: result.subTicket,
    };
  }

  /**
   * List sub-tickets for a parent ticket.
   */
  listSubTickets(parentId: string): SubTicket[] {
    const ticket = this.get(parentId);
    if (!ticket) throw new Error(`Ticket not found: ${parentId}`);
    return ticket.subTickets ?? [];
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
    excludeTags?: string[];
    excludeTypes?: string[];
    search?: string;
  } = {}): Ticket[] {
    const files = readdirSync(this.dir).filter(
      (f) => f.endsWith(".json") && f !== "counter.json"
    );

    const tickets = files
      .map((f) => {
        try {
          const raw = JSON.parse(readFileSync(resolve(this.dir, f), "utf-8"));
          // Skip alias files — they are not real tickets
          if (raw._alias === true) return null;
          return this.normalizeTicket(raw);
        } catch {
          return null;
        }
      })
      .filter((t): t is Ticket => t !== null);

    return tickets.filter((t) => {
      if (filters.project && t.project !== filters.project) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.assignee && !matchAssignee(t.assignee, filters.assignee)) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.tags?.length) {
        if (!filters.tags.every((tag) => t.tags.includes(tag))) return false;
      }
      if (filters.excludeTags?.length) {
        if (filters.excludeTags.some((tag) => t.tags.includes(tag))) return false;
      }
      if (filters.excludeTypes?.length) {
        if (filters.excludeTypes.includes(t.type)) return false;
      }
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        const haystack = `${t.id} ${t.title} ${t.summary}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
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

  /**
   * Return distinct project keys with active ticket counts.
   * Excludes tickets tagged 'archived' or 'backlog' and terminal statuses.
   * Results sorted alphabetically by key.
   */
  getProjectCounts(): Array<{ key: string; count: number }> {
    const tickets = this.list({ excludeTags: ["archived", "backlog"] });
    const counts = new Map<string, number>();
    for (const t of tickets) {
      if (TERMINAL_STATUSES.includes(t.status)) continue;
      counts.set(t.project, (counts.get(t.project) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // ── Move operation ─────────────────────────────────────────────────────────

  /**
   * Update blockedBy references in all tickets that reference the old ID.
   * Replaces oldId with newId in blockedBy arrays atomatically under flock.
   */
  private updateBlockedByReferences(oldId: string, newId: string): void {
    const tickets = this.list();
    for (const ticket of tickets) {
      if (!ticket.blockedBy.includes(oldId)) continue;

      const ticketPath = this.ticketPath(ticket.id);
      const lockPath = this.lockPath;

      const script = [
        "const fs = require('fs');",
        `const tp = ${JSON.stringify(ticketPath)};`,
        `const oldId = ${JSON.stringify(oldId)};`,
        `const newId = ${JSON.stringify(newId)};`,
        "const ticket = JSON.parse(fs.readFileSync(tp, 'utf8'));",
        "ticket.blockedBy = ticket.blockedBy.map(id => id === oldId ? newId : id);",
        "fs.writeFileSync(tp, JSON.stringify(ticket, null, 2));",
      ].join("\n");

      const tmpFile = resolve(tmpdir(), `pa-blockedby-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
      writeFileSync(tmpFile, script);

      try {
        execSync(
          `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
        );
      } finally {
        try { writeFileSync(tmpFile, ""); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  /**
   * Move a ticket from one project to another.
   *
   * Operation ordering (crash safety):
   * 1. Allocate new ID (counter.json updated atomically under flock)
   * 2. Write new ticket file (NEW-ID.json)
   * 3. Add auto-comment on new ticket
   * 4. Replace old file with alias
   * 5. Append audit entries
   * 6. Update blockedBy references
   *
   * @throws Error if ticket not found, target project is same as current, or ticket is in terminal status
   */
  move(id: string, targetProject: string, actor: string): Ticket {
    // Step 0: Get the source ticket
    const sourceTicket = this.get(id);
    if (!sourceTicket) throw new Error(`Ticket not found: ${id}`);

    // F11: Prevent moving to the same project
    if (sourceTicket.project === targetProject) {
      throw new Error(`Ticket is already in project ${targetProject}`);
    }

    // F12: Warn about terminal status tickets
    if (TERMINAL_STATUSES.includes(sourceTicket.status)) {
      process.stderr.write(`Warning: Moving a ticket in terminal status '${sourceTicket.status}'\n`);
    }

    // Step 1: Resolve target project and allocate new ID
    const resolved = resolveProject(targetProject);
    const { key: canonicalKey, prefix } = resolved;
    const newId = this.allocateId(prefix);
    const now = new Date().toISOString();
    const oldId = sourceTicket.id;
    const oldProject = sourceTicket.project;

    // Step 2: Build new ticket with new id + project, preserving all other fields
    const movedTicket: Ticket = {
      ...sourceTicket,
      id: newId,
      project: canonicalKey,
      updatedAt: now,
    };

    // Step 3: Write new ticket file
    writeFileSync(this.ticketPath(newId), JSON.stringify(movedTicket, null, 2));

    // Step 4: Add auto-comment on new ticket (F9)
    const { comment: _autoComment } = this.addComment(
      newId,
      actor,
      `Moved from ${oldId} (project: ${oldProject})`
    );

    // Step 5: Replace old file with alias (F5)
    const alias: AliasRecord = {
      _alias: true,
      movedTo: newId,
      movedAt: now,
      movedBy: actor,
    };
    writeFileSync(this.ticketPath(oldId), JSON.stringify(alias, null, 2));

    // Step 6: Append audit entries (F7) — for both old and new IDs
    this.appendAudit({
      ticket_id: newId,
      action: "moved",
      actor,
      timestamp: now,
      changes: {
        id: [oldId, newId],
        project: [oldProject, canonicalKey],
      },
    });
    this.appendAudit({
      ticket_id: oldId,
      action: "moved",
      actor,
      timestamp: now,
      changes: {
        id: [oldId, newId],
        project: [oldProject, canonicalKey],
      },
    });

    // Step 7: Update blockedBy references (F8)
    this.updateBlockedByReferences(oldId, newId);

    return this.get(newId)!;
  }
}
