import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTicketsDir } from "../lib/paths.js";
import { TicketStore } from "../lib/tickets/index.js";
import { validateAuthor, validateAssignee } from "../lib/tickets/validate.js";
import { formatTicketCard } from "../lib/tickets/display.js";
import { normalizeSandboxPath } from "../lib/agent-api/utils/sandbox.js";
import type {
  Estimate,
  TicketStatus,
  TicketPriority,
  TicketType,
  SubTicketStatus,
  UpdateTicketInput,
  AddDocRefInput,
  DocRef,
  AddLinkedBranchInput,
  AddLinkedCommitInput,
} from "../lib/tickets/index.js";

const ESTIMATES: Estimate[] = ["XS", "S", "M", "L", "XL"];
const TYPES: TicketType[] = ["feature", "bug", "task", "review-request", "work-report", "fyi", "idea", "question"];
const PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low"];
const STATUSES: TicketStatus[] = [
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

/** Required fields per ticket type for summary conformance checks */
const SUMMARY_TEMPLATES: Record<string, string[]> = {
  task: ["WHAT", "WHY", "SCOPE"],
  "review-request": ["WHAT", "DOC", "REVIEW", "NEXT"],
  fyi: ["WHAT", "IMPACT", "ACTION"],
  bug: ["WHAT", "EXPECTED", "REPRO", "SEVERITY"],
  idea: ["WHAT", "WHY"],
  feature: ["WHAT", "WHY", "SCOPE"],
  "plan-draft": ["WHAT", "DOC", "BUDGET"],
  "work-report": ["WHAT", "STATUS", "OUTPUTS"],
  question: ["WHAT", "CONTEXT", "BLOCKING"],
};

function validateEstimate(value: string): Estimate {
  if (!ESTIMATES.includes(value as Estimate)) {
    console.error(`Error: Invalid estimate "${value}". Must be one of: XS, S, M, L, XL`);
    process.exit(1);
  }
  return value as Estimate;
}

function validateType(value: string): TicketType {
  if (!TYPES.includes(value as TicketType)) {
    console.error(`Error: Invalid type "${value}". Must be one of: ${TYPES.join("|")}`);
    process.exit(1);
  }
  return value as TicketType;
}

function validatePriority(value: string): TicketPriority {
  if (!PRIORITIES.includes(value as TicketPriority)) {
    console.error(`Error: Invalid priority "${value}". Must be one of: ${PRIORITIES.join("|")}`);
    process.exit(1);
  }
  return value as TicketPriority;
}

function validateStatus(value: string): TicketStatus {
  if (!STATUSES.includes(value as TicketStatus)) {
    console.error(`Error: Invalid status "${value}". Must be one of: ${STATUSES.join("|")}`);
    process.exit(1);
  }
  return value as TicketStatus;
}

/**
 * Parse --doc-ref value: "[type:]path"
 * - With colon: type is before colon, path is after
 * - Without colon: type defaults to 'attachment' (backward compat — F15)
 */
function parseDocRef(raw: string, primary: boolean): AddDocRefInput {
  const colonIdx = raw.indexOf(":");
  if (colonIdx > 0) {
    return { type: raw.slice(0, colonIdx), path: raw.slice(colonIdx + 1), primary };
  }
  return { type: "attachment", path: raw, primary };
}

/**
 * Parse --linked-branch value: "repo|branch[:sha]"
 * Format: repo|branch or repo|branch:sha
 * Branch names can contain "/" (e.g., "feature/PA-1120-topic"), so we split on "|"
 * and reconstruct: parts[0] = repo, everything between first and last "|" = branch,
 * last part = sha (only if 3+ parts).
 * Delimiter is "|" to avoid conflicts with branch names containing ":" (uncommon but possible).
 */
function parseLinkedBranch(raw: string): AddLinkedBranchInput {
  const parts = raw.split("|");
  if (parts.length < 2) {
    throw new Error(`Invalid --linked-branch format "${raw}". Expected: repo|branch[:sha]`);
  }
  const repo = parts[0];
  const hasSha = parts.length >= 3;
  const branch = hasSha ? parts.slice(1, -1).join("|") : parts.slice(1).join("|");
  const sha = hasSha ? parts[parts.length - 1] : undefined;
  return { repo, branch, sha };
}

/**
 * Parse --linked-commit value: "repo|sha[:message|author|timestamp]"
 * Format: repo|sha or repo|sha:message|author|timestamp
 * parts[0] = repo, parts[1] = sha, parts[2] = message (optional),
 * parts[3] = author (optional), parts[4] = timestamp (optional).
 * Delimiter is "|" to avoid conflicts with commit messages containing ":"
 * (e.g., conventional commits like "feat(tickets): ...").
 */
function parseLinkedCommit(raw: string): AddLinkedCommitInput {
  const parts = raw.split("|");
  if (parts.length < 2) {
    throw new Error(`Invalid --linked-commit format "${raw}". Expected: repo|sha[:message|author|timestamp]`);
  }
  const repo = parts[0];
  const sha = parts[1];
  const message = parts.length >= 3 ? parts[2] : undefined;
  const author = parts.length >= 4 ? parts[3] : undefined;
  const timestamp = parts.length >= 5 ? parts[4] : undefined;
  return { repo, sha, message, author, timestamp };
}

/** Format a doc_refs table for show command */
function formatDocRefsTable(docRefs: DocRef[]): string {
  if (docRefs.length === 0) return "  (none)";
  const header = "  TYPE".padEnd(22) + "PATH".padEnd(60) + "PRIMARY";
  const sep = "  " + "-".repeat(80);
  const rows = docRefs.map((r) => {
    const isUrl = r.path.startsWith("http://") || r.path.startsWith("https://");
    const displayPath = isUrl ? `[url] ${r.path}` : r.path;
    return "  " + r.type.padEnd(20) + displayPath.padEnd(60) + (r.primary ? "✓" : "");
  });
  return [header, sep, ...rows].join("\n");
}

/** Format a ticket row for the list view — defensive null checks for all fields */
function formatRow(id: string, status: string, priority: string, estimate: string, assignee: string, title: string): string {
  return (
    (id ?? "").padEnd(9) +
    (status ?? "").padEnd(25) +
    (priority ?? "").padEnd(11) +
    (estimate ?? "").padEnd(6) +
    (assignee ?? "").padEnd(28) +
    (title ?? "")
  );
}

export function createTicketCommand(): Command {
  const cmd = new Command("ticket").description("Manage tickets");

  // ── create ─────────────────────────────────────────────────────────────────

  cmd
    .command("create")
    .description("Create a new ticket")
    .requiredOption("--project <name>", "Project name (key from repos.yaml)")
    .requiredOption("--title <title>", "Ticket title")
    .requiredOption(
      "--type <type>",
      "Ticket type (feature|bug|task|review-request|work-report|fyi|idea|question)"
    )
    .requiredOption("--priority <priority>", "Priority (critical|high|medium|low)")
    .requiredOption("--estimate <size>", "Effort estimate (XS|S|M|L|XL)")
    .requiredOption("--assignee <name>", "Assignee")
    .option("--summary <text>", "Short summary", "")
    .option("--tags <tags>", "Comma-separated tags", "")
    .option("--doc-ref <path>", "Document reference path", "")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (opts: {
        project: string;
        title: string;
        type: string;
        priority: string;
        estimate: string;
        assignee: string;
        summary: string;
        tags: string;
        docRef: string;
        actor: string;
      }) => {
        const estimate = validateEstimate(opts.estimate);

        try {
          validateAssignee(opts.assignee);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }

        // Compute tags — may be augmented by summary template check
        const tags: string[] = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

        // Soft enforcement: warn + tag if summary doesn't match type template
        const templateFields = SUMMARY_TEMPLATES[opts.type];
        if (templateFields) {
          const hasAllFields = templateFields.every(
            (f) => opts.summary.toUpperCase().includes(`${f}:`)
          );
          if (!hasAllFields) {
            process.stderr.write(
              `Warning: Summary does not match ${opts.type} template (expected ${templateFields.join("/")} fields)\n`
            );
            if (!tags.includes("needs-review")) tags.push("needs-review");
          }
        }

        const ticketType = validateType(opts.type);
        const ticketPriority = validatePriority(opts.priority);

        const store = new TicketStore();
        const initialDocRefs: DocRef[] = [];
        if (opts.docRef) {
          const parsed = parseDocRef(opts.docRef, true);
          initialDocRefs.push({
            type: parsed.type ?? "attachment",
            path: parsed.path,
            primary: true,
            addedAt: new Date().toISOString(),
            addedBy: opts.actor,
          });
        }

        let ticket;
        try {
          ticket = store.create(
            {
              project: opts.project,
              title: opts.title,
              type: ticketType,
              priority: ticketPriority,
              estimate,
              status: "idea",
              summary: opts.summary,
              description: "",
              assignee: opts.assignee,
              tags,
              doc_refs: initialDocRefs,
              from: "",
              to: "",
              blockedBy: [],
              comments: [],
            },
            opts.actor
          );
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        console.log(`Created: ${ticket.id}`);
        console.log(JSON.stringify(ticket, null, 2));
      }
    );

  // ── update ─────────────────────────────────────────────────────────────────

  cmd
    .command("update")
    .description("Update fields on a ticket")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .option("--status <status>", "New status (idea|requirement-review|pending-approval|pending-implementation|implementing|review-uat|done|rejected|cancelled)")
    .option("--assignee <name>", "New assignee")
    .option("--priority <priority>", "New priority (critical|high|medium|low)")
    .option("--tags <tags>", "Comma-separated tags (replaces existing)")
    .option("--blocked-by <ids>", "Comma-separated ticket IDs that block this ticket (replaces existing; empty string to clear)")
    .option("--estimate <size>", "New effort estimate (XS|S|M|L|XL)")
    .option("--doc-ref <value>", "Add document reference: [type:]path (ADDS to array, does not replace). Type defaults to 'attachment'.")
    .option("--doc-ref-primary", "Mark the added doc-ref as primary (demotes any existing primary)")
    .option("--remove-doc-ref <path>", "Remove a doc-ref by exact path match")
    .option("--linked-branch <value>", "Link a branch: repo|branch[:sha] (ADDS to array)")
    .option("--linked-commit <value>", "Link a commit: repo|sha[:message|author|timestamp] (ADDS to array)")
    .option("--remove-linked-branch <value>", "Remove a linked branch by repo|branch")
    .option("--remove-linked-commit <sha>", "Remove a linked commit by SHA")
    .option("--force", "Suppress doc-ref file existence warnings")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (
        id: string,
        opts: {
          status?: string;
          assignee?: string;
          priority?: string;
          tags?: string;
          blockedBy?: string;
          estimate?: string;
          docRef?: string;
          docRefPrimary?: boolean;
          removeDocRef?: string;
          linkedBranch?: string;
          linkedCommit?: string;
          removeLinkedBranch?: string;
          removeLinkedCommit?: string;
          force?: boolean;
          actor: string;
        }
      ) => {
        if (opts.assignee !== undefined) {
          try {
            validateAssignee(opts.assignee);
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        }

        const store = new TicketStore();
        const input: UpdateTicketInput = {};
        if (opts.assignee !== undefined) input.assignee = opts.assignee;
        if (opts.priority) input.priority = opts.priority as TicketPriority;
        if (opts.tags !== undefined) {
          input.tags = opts.tags.split(",").map((t) => t.trim()).filter(Boolean);
        }
        if (opts.blockedBy !== undefined) {
          input.blockedBy = opts.blockedBy ? opts.blockedBy.split(",").map((t) => t.trim()).filter(Boolean) : [];
        }
        if (opts.estimate) {
          input.estimate = validateEstimate(opts.estimate);
        }
        if (opts.docRef !== undefined) {
          const parsedDocRef = parseDocRef(opts.docRef, opts.docRefPrimary ?? false);
          // F2: Validate file existence unless --force is set (skip for URLs)
          if (!opts.force) {
            const isUrl = parsedDocRef.path.startsWith("http://") || parsedDocRef.path.startsWith("https://");
            if (!isUrl) {
              const fullPath = normalizeSandboxPath(parsedDocRef.path);
              if (!existsSync(fullPath)) {
                process.stderr.write(`Warning: doc_ref path does not exist: ${parsedDocRef.path}\n`);
              }
            }
          }
          input.add_doc_ref = parsedDocRef;
        }
        if (opts.removeDocRef !== undefined) {
          input.remove_doc_ref = opts.removeDocRef;
        }
        if (opts.linkedBranch !== undefined) {
          const parsed = parseLinkedBranch(opts.linkedBranch);
          input.add_linked_branch = parsed;
        }
        if (opts.linkedCommit !== undefined) {
          const parsed = parseLinkedCommit(opts.linkedCommit);
          input.add_linked_commit = parsed;
        }
        if (opts.removeLinkedBranch !== undefined) {
          input.remove_linked_branch = opts.removeLinkedBranch;
        }
        if (opts.removeLinkedCommit !== undefined) {
          input.remove_linked_commit = opts.removeLinkedCommit;
        }
        if (opts.status) {
          input.status = validateStatus(opts.status);
        }

        let ticket;
        try {
          ticket = store.update(id, input, opts.actor);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        console.log(`Updated: ${ticket.id}`);
        console.log(JSON.stringify(ticket, null, 2));
      }
    );

  // ── list ───────────────────────────────────────────────────────────────────

  cmd
    .command("list")
    .description("List tickets with optional filters")
    .option("--project <name>", "Filter by project")
    .option("--status <status>", "Filter by status (idea|requirement-review|pending-approval|pending-implementation|implementing|review-uat|done|rejected|cancelled)")
    .option("--assignee <name>", "Filter by assignee")
    .option("--priority <priority>", "Filter by priority (critical|high|medium|low)")
    .option("--type <type>", "Filter by type (feature|bug|task|review-request|work-report|fyi|idea|question)")
    .option("--tags <tags>", "Filter by tags (comma-separated, AND logic)")
    .option("--exclude-tags <tags>", "Exclude tickets with any of these tags (comma-separated)")
    .option("--search <text>", "Free-text search on ticket ID, title, and summary (case-insensitive)")
    .action(
      (opts: {
        project?: string;
        status?: string;
        assignee?: string;
        priority?: string;
        type?: string;
        tags?: string;
        excludeTags?: string;
        search?: string;
      }) => {
        const store = new TicketStore();
        const tickets = store.list({
          project: opts.project,
          status: opts.status,
          assignee: opts.assignee,
          priority: opts.priority,
          type: opts.type,
          tags: opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          excludeTags: opts.excludeTags ? opts.excludeTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          search: opts.search,
        });

        if (tickets.length === 0) {
          console.log("No tickets found.");
          return;
        }

        console.log(formatRow("ID", "STATUS", "PRIORITY", "EST", "ASSIGNEE", "TITLE"));
        console.log("-".repeat(80));
        for (const t of tickets) {
          console.log(formatRow(t.id, t.status, t.priority, t.estimate, t.assignee, t.title));
        }
        console.log(`\n${tickets.length} ticket(s)`);
      }
    );

  // ── show ───────────────────────────────────────────────────────────────────

  cmd
    .command("show")
    .description("Show full ticket details")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .option("--json", "Output raw JSON instead of formatted card")
    .action((id: string, opts: { json?: boolean }) => {
      const store = new TicketStore();

      // Detect if this ID is an alias before calling get() (which follows aliases transparently)
      const rawPath = resolve(getTicketsDir(), `${id}.json`);
      let aliasInfo: { movedTo: string; movedAt: string; movedBy: string } | null = null;
      if (existsSync(rawPath)) {
        try {
          const raw = JSON.parse(readFileSync(rawPath, "utf-8"));
          if (raw._alias === true && typeof raw.movedTo === "string") {
            aliasInfo = { movedTo: raw.movedTo, movedAt: raw.movedAt, movedBy: raw.movedBy };
          }
        } catch { /* ignore parse errors */ }
      }

      const ticket = store.get(id);
      if (!ticket) {
        console.error(`Ticket not found: ${id}`);
        process.exit(1);
      }

      // Print alias redirect notice before the ticket content
      if (aliasInfo) {
        const date = aliasInfo.movedAt ? aliasInfo.movedAt.split("T")[0] : "unknown";
        console.log(`\n  ⚠ This ticket was moved from ${id} on ${date}\n`);
      }

      if (opts.json) {
        console.log(JSON.stringify(ticket, null, 2));
        console.log("\n── Document References ──────────────────────────────────────────────");
        console.log(formatDocRefsTable(ticket.doc_refs ?? []));
      } else {
        console.log(formatTicketCard(ticket));
      }
    });

  // ── attach ─────────────────────────────────────────────────────────────────

  cmd
    .command("attach")
    .description("Attach a file or doc-ref to a ticket")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .requiredOption("--file <path>", "File path or doc-ref to attach")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action((id: string, opts: { file: string; actor: string }) => {
      const store = new TicketStore();
      const ticket = store.attach(id, opts.file, opts.actor);
      console.log(`Attached to ${ticket.id}: ${opts.file}`);
    });

  // ── comment ────────────────────────────────────────────────────────────────

  cmd
    .command("comment")
    .description("Add a comment to a ticket")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .requiredOption("--author <name>", "Comment author")
    .requiredOption("--content <text>", "Comment content")
    .action((id: string, opts: { author: string; content: string }) => {
      try {
        validateAuthor(opts.author);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const store = new TicketStore();
      const { ticket } = store.addComment(id, opts.author, opts.content);
      console.log(`Comment added to ${ticket.id}`);
      // F4: Hint if comment references an artifact path and no doc_refs are set
      const artifactPattern = /agent-teams\/[^\s]+\/artifacts\/[^\s]+|deployments\/[^\s]+/;
      const match = artifactPattern.exec(opts.content);
      if (match && (ticket.doc_refs ?? []).length === 0) {
        process.stderr.write(
          `Hint: This comment references an artifact path. Attach it? pa ticket update ${ticket.id} --doc-ref ${match[0]}\n`
        );
      }
    });

  // ── move ───────────────────────────────────────────────────────────────────

  cmd
    .command("move")
    .description("Move a ticket to another project")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .requiredOption("--project <name>", "Target project name (key from repos.yaml)")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action((id: string, opts: { project: string; actor: string }) => {
      const store = new TicketStore();
      try {
        const newTicket = store.move(id, opts.project, opts.actor);
        console.log(`Moved: ${id} → ${newTicket.id}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── check-refs ──────────────────────────────────────────────────────────────

  cmd
    .command("check-refs")
    .description("Audit all doc_refs in a project and report orphaned (missing) references")
    .requiredOption("--project <name>", "Project name (key from repos.yaml)")
    .action((opts: { project: string }) => {
      const store = new TicketStore();
      const tickets = store.list({ project: opts.project });
      const orphans: { ticketId: string; type: string; path: string; addedAt: string }[] = [];

      for (const ticket of tickets) {
        for (const ref of ticket.doc_refs ?? []) {
          // Skip URL-type or URL-path doc_refs — they don't have local file existence
          const isUrl = ref.path.startsWith("http://") || ref.path.startsWith("https://");
          if (isUrl || ref.type === "url") continue;
          const fullPath = normalizeSandboxPath(ref.path);
          if (!existsSync(fullPath)) {
            orphans.push({
              ticketId: ticket.id,
              type: ref.type,
              path: ref.path,
              addedAt: ref.addedAt,
            });
          }
        }
      }

      if (orphans.length === 0) {
        console.log(`All doc_refs in project '${opts.project}' are valid.`);
        process.exit(0);
      } else {
        console.log(`Orphaned doc_refs (${orphans.length}):`);
        console.log("  TICKET      TYPE                 PATH");
        console.log("  " + "-".repeat(70));
        for (const o of orphans) {
          const date = o.addedAt ? o.addedAt.split("T")[0] : "unknown";
          console.log(`  ${o.ticketId.padEnd(10)} ${o.type.padEnd(19)} ${o.path} (added ${date})`);
        }
        process.exit(1);
      }
    });

  // ── subticket ──────────────────────────────────────────────────────────────

  const subticketCmd = cmd
    .command("subticket")
    .description("Manage sub-tickets embedded in parent tickets");

  const SUB_STATUSES: SubTicketStatus[] = ["open", "in-progress", "done"];

  // ── subticket create ───────────────────────────────────────────────────────

  subticketCmd
    .command("create")
    .description("Create a sub-ticket on a parent ticket")
    .argument("<parent-id>", "Parent ticket ID (e.g. PA-001)")
    .requiredOption("--title <title>", "Sub-ticket title")
    .option("--summary <text>", "Sub-ticket summary", "")
    .option("--assignee <name>", "Assignee", "")
    .option("--priority <priority>", "Priority (critical|high|medium|low)", "medium")
    .option("--estimate <size>", "Effort estimate (XS|S|M|L|XL)", "S")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (
        parentId: string,
        opts: {
          title: string;
          summary: string;
          assignee: string;
          priority: string;
          estimate: string;
          actor: string;
        }
      ) => {
        const priority = validatePriority(opts.priority);
        const estimate = validateEstimate(opts.estimate);

        const store = new TicketStore();
        try {
          const { subTicket } = store.addSubTicket(
            parentId,
            {
              title: opts.title,
              summary: opts.summary,
              assignee: opts.assignee,
              priority,
              estimate,
            },
            opts.actor
          );
          console.log(`Created sub-ticket: ${subTicket.id}`);
          console.log(JSON.stringify(subTicket, null, 2));
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    );

  // ── subticket update ───────────────────────────────────────────────────────

  subticketCmd
    .command("update")
    .description("Update fields on a sub-ticket")
    .argument("<parent-id>", "Parent ticket ID (e.g. PA-001)")
    .argument("<subticket-id>", "Sub-ticket ID (e.g. PA-001-ST-1)")
    .option("--status <status>", "New status (open|in-progress|done)")
    .option("--assignee <name>", "New assignee")
    .option("--title <title>", "New title")
    .option("--summary <text>", "New summary")
    .option("--priority <priority>", "New priority (critical|high|medium|low)")
    .option("--estimate <size>", "New estimate (XS|S|M|L|XL)")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (
        parentId: string,
        subticketId: string,
        opts: {
          status?: string;
          assignee?: string;
          title?: string;
          summary?: string;
          priority?: string;
          estimate?: string;
          actor: string;
        }
      ) => {
        const input: Record<string, unknown> = {};
        if (opts.status !== undefined) {
          if (!SUB_STATUSES.includes(opts.status as SubTicketStatus)) {
            console.error(`Error: Invalid sub-ticket status "${opts.status}". Must be one of: ${SUB_STATUSES.join("|")}`);
            process.exit(1);
          }
          input.status = opts.status;
        }
        if (opts.assignee !== undefined) input.assignee = opts.assignee;
        if (opts.title !== undefined) input.title = opts.title;
        if (opts.summary !== undefined) input.summary = opts.summary;
        if (opts.priority !== undefined) input.priority = validatePriority(opts.priority);
        if (opts.estimate !== undefined) input.estimate = validateEstimate(opts.estimate);

        const store = new TicketStore();
        try {
          const { subTicket } = store.updateSubTicket(parentId, subticketId, input, opts.actor);
          console.log(`Updated: ${subTicket.id}`);
          console.log(JSON.stringify(subTicket, null, 2));
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    );

  // ── subticket complete ─────────────────────────────────────────────────────

  subticketCmd
    .command("complete")
    .description("Mark a sub-ticket as done (shortcut for update --status done)")
    .argument("<parent-id>", "Parent ticket ID (e.g. PA-001)")
    .argument("<subticket-id>", "Sub-ticket ID (e.g. PA-001-ST-1)")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (parentId: string, subticketId: string, opts: { actor: string }) => {
        const store = new TicketStore();
        try {
          const { subTicket } = store.updateSubTicket(
            parentId,
            subticketId,
            { status: "done" },
            opts.actor
          );
          console.log(`Completed: ${subTicket.id}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    );

  // ── subticket list ─────────────────────────────────────────────────────────

  subticketCmd
    .command("list")
    .description("List sub-tickets for a parent ticket")
    .argument("<parent-id>", "Parent ticket ID (e.g. PA-001)")
    .action((parentId: string) => {
      const store = new TicketStore();
      try {
        const subTickets = store.listSubTickets(parentId);
        if (subTickets.length === 0) {
          console.log(`No sub-tickets on ${parentId}.`);
          return;
        }
        console.log("ID".padEnd(18) + "STATUS".padEnd(14) + "PRIORITY".padEnd(11) + "EST".padEnd(6) + "ASSIGNEE".padEnd(20) + "TITLE");
        console.log("-".repeat(80));
        for (const st of subTickets) {
          console.log(
            st.id.padEnd(18) +
            st.status.padEnd(14) +
            st.priority.padEnd(11) +
            st.estimate.padEnd(6) +
            (st.assignee || "—").padEnd(20) +
            st.title
          );
        }
        console.log(`\n${subTickets.length} sub-ticket(s)`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
