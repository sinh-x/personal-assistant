import { resolve } from "node:path";
import { homedir } from "node:os";
import { deployCommand } from "./deploy.js";

/** Format date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Daily lifecycle wrapper — validates mode and deploys the daily team.
 * Mode files are read by primer.ts via the objective: field in daily.yaml deploy_modes.
 * Template variable substitution is handled by primer.ts.
 */
export function dailyCommand(
  mode: string,
  args: string[]
): void {
  // Validate mode
  if (!["plan", "progress", "end"].includes(mode)) {
    console.error(`Error: Unknown mode '${mode}'. Use: plan | progress | end`);
    process.exit(1);
  }

  // Parse remaining args: optional date + --review + optional deploy flag
  let targetDate = "";
  let isReview = false;
  let deployFlag = "";
  for (const arg of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      targetDate = arg;
    } else if (arg === "--review") {
      isReview = true;
    } else {
      deployFlag = arg;
    }
  }

  const today = targetDate || formatDate(new Date());
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);
  const home = homedir();
  const outputDir = resolve(home, `Documents/ai-usage/daily/${year}/${month}`);
  const dailyInbox = `${home}/Documents/ai-usage/agent-teams/daily/inbox`;

  // Mode file ID (plan, progress, end, plan-review, end-review)
  const modeFileId = isReview ? `${mode}-review` : mode;

  // Template variables for mode file substitution (passed to primer.ts)
  const templateVars: Record<string, string> = {
    TODAY: today,
    YEAR: year,
    MONTH: month,
    OUTPUT_DIR: outputDir,
    HOME: home,
    INPUT_NOTES: resolve(home, `Documents/ai-usage/sinh-inputs/daily-plan/${today}`),
    RPM_BLOCKS: resolve(home, `Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml`),
    DAILY_INBOX: dailyInbox,
    GATHER_REPORT: `${dailyInbox}/${today}-end-gather.md`,
    READY_MARKER: `${dailyInbox}/${today}-end-ready.md`,
    DRAFT_PATH: `${outputDir}/${today}-plan-draft.md`,
  };

  // Build deploy opts
  // Review modes default to foreground; gather/plan/progress default to background
  const deployOpts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    mode?: string;
    templateVars?: Record<string, string>;
  } = {
    mode: modeFileId,
    templateVars,
  };

  if (!isReview && mode !== "progress") {
    deployOpts.background = true; // gather and plan run unattended
  }

  switch (deployFlag) {
    case "--dry-run":
      deployOpts.dryRun = true;
      break;
    case "--background":
      deployOpts.background = true;
      break;
    case "--interactive":
      deployOpts.interactive = true;
      break;
  }

  deployCommand("daily", deployOpts);
}
