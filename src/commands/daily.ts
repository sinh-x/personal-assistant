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

/**
 * Read a mode file from teams/daily/modes/<modeId>.md and substitute
 * {{PLACEHOLDER}} variables with runtime values.
 */
function readModeFile(
  modeId: string,
  vars: Record<string, string>,
  teamsDir: string
): string {
  const modePath = resolve(teamsDir, `daily/modes/${modeId}.md`);
  if (!existsSync(modePath)) {
    throw new Error(`Mode file not found: ${modePath}`);
  }
  let content = readFileSync(modePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
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
  const outputDir = resolve(homedir(), `Documents/ai-usage/daily/${year}/${month}`);
  const dailyInbox = `${homedir()}/Documents/ai-usage/agent-teams/daily/inbox`;

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

  // Build mode file ID and template variables
  const modeFileId = isReview ? `${mode}-review` : mode;
  const vars: Record<string, string> = {
    TODAY: today,
    YEAR: year,
    MONTH: month,
    OUTPUT_DIR: outputDir,
    HOME: homedir(),
    INPUT_NOTES: resolve(homedir(), `Documents/ai-usage/sinh-inputs/daily-plan/${today}`),
    RPM_BLOCKS: resolve(homedir(), `Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml`),
    DAILY_INBOX: dailyInbox,
    GATHER_REPORT: `${dailyInbox}/${today}-end-gather.md`,
    READY_MARKER: `${dailyInbox}/${today}-end-ready.md`,
    DRAFT_PATH: `${homedir()}/Documents/ai-usage/sinh-inputs/inbox/${today}-plan-draft.md`,
  };

  // Read mode file and substitute variables
  let objective: string;
  try {
    objective = readModeFile(modeFileId, vars, teamsDir);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
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

  // Build deploy opts
  // Review modes default to foreground; gather/plan/progress default to background
  const deployOpts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    mode?: string;
  } = {
    mode: modeFileId,
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

  deployCommand(tmpFile, deployOpts);

  // Clean up temp file (non-critical)
  try {
    unlinkSync(tmpFile);
  } catch {
    // Best effort cleanup
  }
}
