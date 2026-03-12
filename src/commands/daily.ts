import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadConfig } from "../lib/config.js";
import { getHomeDir } from "../lib/paths.js";
import { deployCommand } from "./deploy.js";

/** Format date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build the plan objective */
function planObjective(today: string, year: string, month: string, outputDir: string): string {
  const inputNotes = resolve(homedir(), `Documents/ai-usage/sinh-inputs/daily-plan/${today}`);
  return `MODE: DAILY PLAN (morning) — SOLO (no sub-agents)
TARGET_DATE: ${today}

Create the daily plan for ${today}. You do this YOURSELF — do NOT spawn any sub-agents.

Workflow (you do all steps directly):
1. Check for user notes at ${inputNotes}
   - If the file exists, read it FIRST — these are Sinh's personal notes, priorities, or instructions for today
   - Incorporate these notes as HIGH PRIORITY items in the plan
   - The notes may contain specific goals, meetings, reminders, or overrides to the usual workflow
2. Read yesterday's daily summary (end-of-day) from ${outputDir}/ — look for the most recent *-daily.md
   - Extract 'Tomorrow's Priorities' as today's starting goals
   - Extract 'Open Items (Carried Forward)' as carryover todos
   - If no daily summary exists, check for recent session logs in ~/Documents/ai-usage/sessions/${year}/${month}/
3. Check your team inbox at ~/Documents/ai-usage/agent-teams/daily/inbox/
   - Read any files — these are context documents routed by the secretary
   - Incorporate relevant context into the plan
   - After processing, move each file to inbox/processed/
4. Get current avo task list and status:
   - Run: /home/sinh/.nix-profile/bin/avo task list
   - Run: /home/sinh/.nix-profile/bin/avo plan list
   - Run: /home/sinh/.nix-profile/bin/avo status
5. Use avo to plan the day's tasks:
   - Based on goals from steps 1-4, schedule tasks with avo:
     /home/sinh/.nix-profile/bin/avo plan add -t <task-id> -d <duration> -m <notes>
   - Prioritize P0 first, then P1, P2, etc.
   - Do not over-schedule — respect realistic time budget
   - If a goal has no matching avo task, note it for Sinh to create
6. Write the daily plan as a DRAFT for Sinh to review when he's ready

Output: ${homedir()}/Documents/ai-usage/sinh-inputs/for-sinh-review/${today}-plan-draft.md

IMPORTANT: This is a DRAFT — it runs at 05:00 before Sinh is awake.
- Save to sinh-inputs/for-sinh-review/ (NOT the daily folder) so Sinh finds it in his review queue
- Save as *-plan-draft.md (not -plan.md)
- Add a header: ## DRAFT — Review and adjust when ready
- Include a checklist at the top for quick review:
  - [ ] Goals look right
  - [ ] Time budget is realistic
  - [ ] No missing priorities
  - [ ] Avo plan looks right
- Add a ## Next Steps section at the bottom explaining:
  1. Review and adjust goals/time budget above
  2. Finalize by copying to ${outputDir}/${today}-plan.md (or ask pa to finalize)
  3. Optionally add notes for tomorrow at ${inputNotes} before going to bed
- Sinh will review this draft and finalize it himself

Plan document structure:
  ## User Notes (if ${inputNotes} exists)
  (Sinh's own notes for the day, verbatim or summarized)
  ## Today's Goals (from user notes + yesterday's priorities + new items)
  | # | Goal | Source | Priority |
  ## Avo Day Plan
  (output of avo plan list after scheduling)
  ## Time Budget
  | Category | Planned | Notes |
  ## Open Items Carried Forward
  - [ ] item (from session/date)
  ## Today's Task List
  (from avo task list, prioritized)
`;
}

/** Build the progress objective */
function progressObjective(today: string, outputDir: string): string {
  return `MODE: DAILY PROGRESS (mid-day)
TARGET_DATE: ${today}

Check progress toward the plan for ${today}.

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read TODAY's sessions so far
   - jsonl-analyst: get today's JSONL stats so far
   - time-tracker: get avo current status, plan vs actual so far
2. Once all three are done, spawn synthesizer with their data and this instruction:
   - Read today's plan from ${outputDir}/${today}-plan.md
   - Compare planned goals vs actual activity
   - Produce a progress report

Output: ${outputDir}/${today}-progress.md

Progress document structure:
  ## Goal Progress
  | Goal | Status | Evidence | Notes |
  (Done / In Progress / Not Started / Blocked)
  ## Time Budget vs Actual (so far)
  | Category | Planned | Actual So Far | Remaining |
  ## Activity So Far
  - Sessions: N | Duration: Xh | Tool calls: N
  ## Adjustments
  - Goals to deprioritize (running out of time)
  - New items that emerged
  ## Remaining Plan
  - What to focus on for the rest of the day
`;
}

/** Build the end objective */
function endObjective(today: string, outputDir: string): string {
  return `MODE: DAILY END (evening)
TARGET_DATE: ${today}

Produce the end-of-day summary for ${today} and plan for the next day.

Workflow:
1. Spawn session-gatherer, jsonl-analyst, and time-tracker IN PARALLEL
   - session-gatherer: read ALL of today's sessions (human + agent-team)
   - jsonl-analyst: get full day JSONL stats
   - time-tracker: get full day avo report
2. Once all three are done, spawn synthesizer with their data and this instruction:
   - Read today's plan from ${outputDir}/${today}-plan.md (if exists)
   - Read today's progress from ${outputDir}/${today}-progress.md (if exists)
   - Compare planned vs actual for the full day
   - Produce the final daily summary

Output: ${outputDir}/${today}-daily.md

Daily summary document structure:
  ## Day at a Glance
  | Metric | Value |
  (sessions, duration, tracked time, tool calls, done items, completion rate, teams deployed)

  ## Goal Completion
  | Goal | Status | Evidence |
  Goal completion: N/M (XX%)

  ## Time Tracking
  Plan vs actual by category, time gaps

  ## What Got Done
  ### Human Work (grouped by project)
  ### Agent Work (grouped by team)

  ## What I Learned
  ### From Human Sessions
  ### From Agent Teams
  ### Cross-Cutting Insights

  ## Deductions & Observations
  - Productivity patterns (peak hours, session lengths)
  - Tool & workflow insights
  - Recurring issues (across sessions and days)
  - Progress trends (vs previous days)

  ## Open Items (Carried Forward)
  Consolidated from all sessions

  ## Tomorrow's Priorities
  1. [ ] Priority — reasoning from today's data
  2. [ ] Priority — reasoning
  3. [ ] Priority — reasoning

  ## Stats Deep Dive
  Token usage, tool histogram, model distribution, projects, activity timeline
`;
}

/**
 * Daily lifecycle wrapper — sets the mode and deploys the daily team.
 * Replaces daily.sh (237 lines).
 */
export function dailyCommand(
  mode: string,
  args: string[]
): void {
  const config = loadConfig();
  const paHome = getHomeDir();

  // Validate mode
  if (!["plan", "progress", "end"].includes(mode)) {
    console.error(`Error: Unknown mode '${mode}'. Use: plan | progress | end`);
    process.exit(1);
  }

  // Parse remaining args: optional date + optional flag
  let targetDate = "";
  let extra = "";
  for (const arg of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      targetDate = arg;
    } else {
      extra = arg;
    }
  }

  const today = targetDate || formatDate(new Date());
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);
  const outputDir = resolve(homedir(), `Documents/ai-usage/daily/${year}/${month}`);

  // Build mode-specific objective
  let objective: string;
  switch (mode) {
    case "plan":
      objective = planObjective(today, year, month, outputDir);
      break;
    case "progress":
      objective = progressObjective(today, outputDir);
      break;
    case "end":
      objective = endObjective(today, outputDir);
      break;
    default:
      console.error(`Error: Unknown mode '${mode}'`);
      process.exit(1);
  }

  // Resolve daily.yaml: PA_CONFIG first, then PA_HOME
  let teamsDir: string;
  if (config.configDir && existsSync(resolve(config.configDir, "teams/daily.yaml"))) {
    teamsDir = resolve(config.configDir, "teams");
  } else {
    teamsDir = resolve(paHome, "teams");
  }

  const dailyYaml = resolve(teamsDir, "daily.yaml");
  if (!existsSync(dailyYaml)) {
    console.error(`Error: daily.yaml not found in ${teamsDir}`);
    process.exit(1);
  }

  // Build temp team file with injected objective
  const content = readFileSync(dailyYaml, "utf-8");
  // Strip everything from "objective:" onwards
  const lines = content.split("\n");
  const objectiveIdx = lines.findIndex((l) => l.startsWith("objective:"));
  const beforeObjective = objectiveIdx >= 0 ? lines.slice(0, objectiveIdx) : lines;

  const tempContent =
    beforeObjective.join("\n") +
    "\nobjective: |\n" +
    objective
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n") +
    "\n";

  // Write to temp file
  const tempDir = resolve(tmpdir(), "pa-daily");
  mkdirSync(tempDir, { recursive: true });
  const tmpFile = resolve(tempDir, `daily-${mode}-${Date.now()}.yaml`);
  writeFileSync(tmpFile, tempContent);

  // Deploy using temp file path
  const deployOpts: {
    dryRun?: boolean;
    foreground?: boolean;
    interactive?: boolean;
  } = {};

  switch (extra) {
    case "--dry-run":
      deployOpts.dryRun = true;
      break;
    case "--foreground":
      deployOpts.foreground = true;
      break;
    case "--interactive":
      deployOpts.interactive = true;
      break;
  }

  deployCommand(tmpFile, deployOpts);

  // Clean up temp file (non-critical)
  try {
    unlinkSync(tmpFile);
  } catch {
    // Best effort cleanup
  }
}
