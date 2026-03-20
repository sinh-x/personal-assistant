import { resolve } from "node:path";
import { homedir } from "node:os";
import { deployCommand } from "./deploy.js";

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
 * Requirements lifecycle wrapper — validates mode and deploys the requirements team.
 * Delegates to deployCommand(); no YAML manipulation or temp file creation.
 */
export function requirementsCommand(
  mode: string,
  args: string[]
): void {
  // Validate mode
  if (!["ideas"].includes(mode)) {
    console.error(`Error: Unknown mode '${mode}'. Use: ideas`);
    process.exit(1);
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
