import { resolve } from "node:path";
import { homedir } from "node:os";
import { deployCommand } from "./deploy.js";
import { buildFocusList } from "../lib/tickets/focus.js";

/** Build the ideas triage objective */
function ideasObjective(flags: { force?: boolean; dryRun?: boolean }): string {
  const ideasDir = resolve(homedir(), "Documents/ai-usage/sinh-inputs/ideas");
  const flagLines: string[] = [];
  if (flags.force) flagLines.push("FLAG: --force (re-triage all ideas regardless of status)");
  if (flags.dryRun) flagLines.push("FLAG: --dry-run (print what would happen, do not write files)");

  return `MODE: REQUIREMENTS — IDEAS TRIAGE (automated)

You are running as a solo requirements analyst — do NOT spawn sub-agents.

When you pick up an inbox item for multi-step work, move it to
\`agent-teams/requirements/ongoing/\` BEFORE starting. Move to \`done/\` when complete.

Follow the triage-ideas.md skill (Phases T1-T6) to:
1. Scan all idea files in ${ideasDir}
2. Group ideas by project/topic
3. Identify connections between ideas
4. Build a triage proposal
5. Save outputs (proposal to Sinh inbox, move triaged ideas, update statuses)
6. Check for approved proposals and process them

${flagLines.length > 0 ? flagLines.join("\n") : "No special flags set. Triage only Status: new ideas."}
`;
}

/**
 * Build the focus objective for MiniMax agent processing (Phase 2).
 * Currently unused — Phase 1 uses direct focus list printing.
 */
function focusObjective(): string {
  return `MODE: REQUIREMENTS — FOCUS PROCESSING (automated)

You are running as a solo requirements analyst — do NOT spawn sub-agents.

Read the latest focus list via: pa requirements focus --enrich
Or directly via the API: curl http://localhost:3000/api/focus?enrich=true

Follow the focus-objective.md skill to:
1. Review the focus list with staleness and bottleneck analysis
2. Generate per-item AI suggestions
3. Save a focus report to agent-teams/requirements/artifacts/YYYY-MM-DD-focus-report.md
`;
}

/**
 * Handle focus mode directly — print the GTD focus list to stdout.
 * Parses --project, --assignee, --all, --mine, --enrich flags.
 */
function handleFocusMode(args: string[]): void {
  const parsed = parseFocusArgs(args);
  const { project, assignee, includeAll, enrich } = parsed;

  const result = buildFocusList({ project, assignee, includeAll });

  // Print WIP summary
  console.log("# GTD Focus List\n");
  console.log(`**Total:** ${result.wip.total} items\n`);

  // Print WIP by project
  console.log("## WIP by Project");
  for (const [proj, count] of Object.entries(result.wip.byProject).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${proj}: ${count}`);
  }
  console.log();

  // Print WIP by status
  console.log("## WIP by Status");
  for (const [status, count] of Object.entries(result.wip.byStatus)) {
    if (count > 0) {
      console.log(`  ${status}: ${count}`);
    }
  }
  console.log();

  // Print focus items
  console.log("## Focus Items\n");
  for (const item of result.focus) {
    const staleFlag = item.staleDays > 0 ? ` [STALE ${item.staleDays}d]` : "";
    const blockedFlag = item.isBlocked ? ` [BLOCKED${item.blockerIds.length > 0 ? ` by ${item.blockerIds.join(", ")}` : ""}]` : "";
    console.log(`**${item.id}** ${item.title}`);
    console.log(`  ${item.project} | ${item.status} | ${item.priority} | ${item.assignee || "unassigned"}${staleFlag}${blockedFlag}`);
    console.log(`  Updated: ${item.updatedAt}`);
    console.log();
  }

  if (enrich) {
    console.log("## AI Suggestions");
    console.log("(Run `pa deploy requirements --mode focus` to generate fresh suggestions)\n");
    // Suggestions would be loaded from cached report if enrich is fully implemented
  }
}

/**
 * Parse focus mode args: --project, --assignee, --all, --mine, --enrich
 * CLI already parses the --project and --assignee options, but we need to handle
 * cases where they're passed as positional args.
 */
function parseFocusArgs(args: string[]): {
  project?: string;
  assignee?: string;
  includeAll?: boolean;
  enrich?: boolean;
} {
  let project: string | undefined;
  let assignee: string | undefined;
  let includeAll = false;
  let enrich = false;
  let expectProject = false;
  let expectAssignee = false;

  for (const arg of args) {
    if (expectProject) {
      project = arg;
      expectProject = false;
    } else if (expectAssignee) {
      assignee = arg;
      expectAssignee = false;
    } else if (arg === "--project") {
      expectProject = true;
    } else if (arg === "--assignee") {
      expectAssignee = true;
    } else if (arg === "--all") {
      includeAll = true;
    } else if (arg === "--mine") {
      assignee = "sinh";
    } else if (arg === "--enrich") {
      enrich = true;
    }
  }

  return { project, assignee, includeAll, enrich };
}

/**
 * Requirements lifecycle wrapper — validates mode and deploys the requirements team.
 * Delegates to deployCommand(); no YAML manipulation or temp file creation.
 */
export function requirementsCommand(
  mode: string,
  args: string[]
): void {
  // Validate mode
  if (!["ideas", "focus"].includes(mode)) {
    console.error(`Error: Unknown mode '${mode}'. Use: ideas, focus`);
    process.exit(1);
  }

  // Handle focus mode directly — print focus list to stdout
  if (mode === "focus") {
    handleFocusMode(args);
    return;
  }

  // Parse flags
  let force = false;
  let dryRun = false;
  let deployFlag = "";
  for (const arg of args) {
    if (arg === "--force") {
      force = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      deployFlag = arg;
    }
  }

  // Build deploy opts — ideas mode defaults to background
  const deployOpts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    mode?: string;
    objective?: string;
  } = {
    mode,
    objective: ideasObjective({ force, dryRun }),
    background: true,
  };

  if (deployFlag === "--dry-run" || dryRun) {
    deployOpts.dryRun = true;
    deployOpts.background = false;
  } else if (deployFlag === "--background") {
    deployOpts.background = true;
  } else if (deployFlag === "--interactive") {
    deployOpts.interactive = true;
    deployOpts.background = false;
  }

  deployCommand("requirements", deployOpts);
}
