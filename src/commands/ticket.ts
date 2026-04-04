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
  UpdateTicketInput,
  AddDocRefInput,
  DocRef,
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

/** Format a doc_refs table for show command */
function formatDocRefsTable(docRefs: DocRef[]): string {
  if (docRefs.length === 0) return "  (none)";
  const header = "  TYPE".padEnd(22) + "PATH".padEnd(60) + "PRIMARY";
  const sep = "  " + "-".repeat(80);
  const rows = docRefs.map((r) =>
    "  " + r.type.padEnd(20) + r.path.padEnd(60) + (r.primary ? "✓" : "")
  );
  return [header, sep, ...rows].join("\n");
}

/** Format a ticket row for the list view */
function formatRow(id: string, status: string, priority: string, estimate: string, assignee: string, title: string): string {
  return (
    id.padEnd(9) +
    status.padEnd(25) +
    priority.padEnd(11) +
    estimate.padEnd(6) +
    (assignee ?? "").padEnd(28) +
    title
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
          // F2: Validate file existence unless --force is set
          if (!opts.force) {
            const fullPath = normalizeSandboxPath(parsedDocRef.path);
            if (!existsSync(fullPath)) {
              process.stderr.write(`Warning: doc_ref path does not exist: ${parsedDocRef.path}\n`);
            }
          }
          input.add_doc_ref = parsedDocRef;
        }
        if (opts.removeDocRef !== undefined) {
          input.remove_doc_ref = opts.removeDocRef;
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

  return cmd;
}
