import { Command } from "commander";
import { TicketStore } from "../lib/tickets/index.js";
import type {
  Estimate,
  TicketStatus,
  TicketPriority,
  TicketType,
  UpdateTicketInput,
} from "../lib/tickets/index.js";

const ESTIMATES: Estimate[] = ["XS", "S", "M", "L", "XL"];

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

/** Format a ticket row for the list view */
function formatRow(id: string, status: string, priority: string, estimate: string, assignee: string, title: string): string {
  return (
    id.padEnd(9) +
    status.padEnd(25) +
    priority.padEnd(11) +
    estimate.padEnd(6) +
    assignee.padEnd(16) +
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
    .option("--from <team>", "From team", "")
    .option("--to <team>", "To team", "")
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
        from: string;
        to: string;
        actor: string;
      }) => {
        const estimate = validateEstimate(opts.estimate);

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

        const store = new TicketStore();
        const ticket = store.create(
          {
            project: opts.project,
            title: opts.title,
            type: opts.type as TicketType,
            priority: opts.priority as TicketPriority,
            estimate,
            status: "idea",
            summary: opts.summary,
            description: "",
            assignee: opts.assignee,
            tags,
            doc_ref: opts.docRef,
            from: opts.from,
            to: opts.to,
            dependencies: [],
            attachments: [],
            comments: [],
          },
          opts.actor
        );
        console.log(`Created: ${ticket.id}`);
        console.log(JSON.stringify(ticket, null, 2));
      }
    );

  // ── update ─────────────────────────────────────────────────────────────────

  cmd
    .command("update")
    .description("Update fields on a ticket")
    .argument("<id>", "Ticket ID (e.g. PA-001)")
    .option("--status <status>", "New status (idea|requirement-review|pending-approval|pending-implementation|implementing|review-uat|done|rejected|on-hold|cancelled)")
    .option("--assignee <name>", "New assignee")
    .option("--priority <priority>", "New priority (critical|high|medium|low)")
    .option("--tags <tags>", "Comma-separated tags (replaces existing)")
    .option("--estimate <size>", "New effort estimate (XS|S|M|L|XL)")
    .option("--actor <name>", "Actor for audit log", "cli-user")
    .action(
      (
        id: string,
        opts: {
          status?: string;
          assignee?: string;
          priority?: string;
          tags?: string;
          estimate?: string;
          actor: string;
        }
      ) => {
        const store = new TicketStore();
        const input: UpdateTicketInput = {};
        if (opts.status) input.status = opts.status as TicketStatus;
        if (opts.assignee !== undefined) input.assignee = opts.assignee;
        if (opts.priority) input.priority = opts.priority as TicketPriority;
        if (opts.tags !== undefined) {
          input.tags = opts.tags.split(",").map((t) => t.trim()).filter(Boolean);
        }
        if (opts.estimate) {
          input.estimate = validateEstimate(opts.estimate);
        }
        const ticket = store.update(id, input, opts.actor);
        console.log(`Updated: ${ticket.id}`);
        console.log(JSON.stringify(ticket, null, 2));
      }
    );

  // ── list ───────────────────────────────────────────────────────────────────

  cmd
    .command("list")
    .description("List tickets with optional filters")
    .option("--project <name>", "Filter by project")
    .option("--status <status>", "Filter by status")
    .option("--assignee <name>", "Filter by assignee")
    .option("--priority <priority>", "Filter by priority")
    .option("--type <type>", "Filter by type")
    .action(
      (opts: {
        project?: string;
        status?: string;
        assignee?: string;
        priority?: string;
        type?: string;
      }) => {
        const store = new TicketStore();
        const tickets = store.list({
          project: opts.project,
          status: opts.status,
          assignee: opts.assignee,
          priority: opts.priority,
          type: opts.type,
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
    .action((id: string) => {
      const store = new TicketStore();
      const ticket = store.get(id);
      if (!ticket) {
        console.error(`Ticket not found: ${id}`);
        process.exit(1);
      }
      console.log(JSON.stringify(ticket, null, 2));
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
      const store = new TicketStore();
      const { ticket } = store.addComment(id, opts.author, opts.content);
      console.log(`Comment added to ${ticket.id}`);
    });

  return cmd;
}
