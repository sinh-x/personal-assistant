import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadConfig } from "../lib/config.js";
import { getHomeDir } from "../lib/paths.js";
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
 * Requirements lifecycle wrapper — sets the mode and deploys the requirements team.
 * Follows the daily.ts pattern: builds mode-specific objective, injects into team YAML,
 * delegates to deployCommand().
 */
export function requirementsCommand(
  mode: string,
  args: string[]
): void {
  const config = loadConfig();
  const paHome = getHomeDir();

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

  // Build mode-specific objective
  let objective: string;
  switch (mode) {
    case "ideas":
      objective = ideasObjective({ force, dryRun });
      break;
    default:
      console.error(`Error: Unknown mode '${mode}'`);
      process.exit(1);
  }

  // Resolve requirements.yaml: PA_CONFIG first, then PA_HOME
  let teamsDir: string;
  if (config.configDir && existsSync(resolve(config.configDir, "teams/requirements.yaml"))) {
    teamsDir = resolve(config.configDir, "teams");
  } else {
    teamsDir = resolve(paHome, "teams");
  }

  const requirementsYaml = resolve(teamsDir, "requirements.yaml");
  if (!existsSync(requirementsYaml)) {
    console.error(`Error: requirements.yaml not found in ${teamsDir}`);
    process.exit(1);
  }

  // Build temp team file with injected objective
  const content = readFileSync(requirementsYaml, "utf-8");
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
  const tempDir = resolve(tmpdir(), "pa-requirements");
  mkdirSync(tempDir, { recursive: true });
  const tmpFile = resolve(tempDir, `requirements-${mode}-${Date.now()}.yaml`);
  writeFileSync(tmpFile, tempContent);

  // Build deploy opts — ideas mode defaults to background
  const deployOpts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
  } = {};

  // Ideas triage is automated — default to background
  deployOpts.background = true;

  if (deployFlag === "--dry-run" || dryRun) {
    deployOpts.dryRun = true;
    deployOpts.background = false;
  } else if (deployFlag === "--background") {
    deployOpts.background = true;
  } else if (deployFlag === "--interactive") {
    deployOpts.interactive = true;
    deployOpts.background = false;
  }

  deployCommand(tmpFile, deployOpts);

  // Clean up temp file (non-critical)
  try {
    unlinkSync(tmpFile);
  } catch {
    // Best effort cleanup
  }
}
