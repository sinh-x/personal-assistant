import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, copyFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getHomeDir, getDataDir, getRegistryDbPath } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
import { appendRegistryEvent, getDeploymentEvents, queryDeploymentStatus } from "../lib/registry.js";
import { generatePrimer, resolveGhRepo } from "../lib/primer.js";
import { resolveRepo, listRepos } from "../lib/repos.js";
import { isTeamBlocked } from "../lib/bulletins/index.js";
import { TicketStore } from "../lib/tickets/store.js";
import { spawnDetached, isProcessAlive } from "../utils/process.js";
import { localISOTimestamp } from "../lib/time.js";
import type { DeployMode, RegistryEvent, TeamConfig } from "../lib/types.js";

const VALID_MODELS = new Set(["haiku", "sonnet", "opus"]);
const MIN_TIMEOUT = 60;
const MAX_TIMEOUT = 7200;
const DEFAULT_TIMEOUT = 2700;

/** Validate timeout is within bounds (60-7200s). Returns error message or undefined if valid. */
function validateTimeout(timeout: number | undefined, _source: string): string | undefined {
  if (timeout === undefined) return undefined;
  if (timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) {
    return `timeout must be between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} seconds`;
  }
  return undefined;
}

/** Resolve effective model for team-manager and each agent, applying Sonnet floor and validation */
function resolveEffectiveModels(
  teamConfig: TeamConfig,
  opts: { teamModel?: string; agentModel?: string; modeModel?: string },
  warnings: string[]
): { tmModel: string | undefined; agentModels: Record<string, string | undefined> } {
  // Precedence: explicit --team-model CLI flag > per-mode YAML model > team-level YAML model
  let tmModel: string | undefined = opts.teamModel ?? opts.modeModel ?? teamConfig.model ?? undefined;
  if (tmModel === "haiku") {
    warnings.push('team-manager model "haiku" upgraded to "sonnet" (minimum floor)');
    console.log('Warning: team-manager model "haiku" upgraded to "sonnet" (minimum floor)');
    tmModel = "sonnet";
  }
  if (tmModel !== undefined && !VALID_MODELS.has(tmModel)) {
    warnings.push(`unknown model "${tmModel}" for team-manager`);
    console.warn(`Warning: unknown model "${tmModel}" for team-manager — ignored`);
    tmModel = undefined;
  }

  const agentModels: Record<string, string | undefined> = {};
  for (const agent of teamConfig.agents) {
    const m = opts.agentModel ?? agent.model ?? teamConfig.model ?? undefined;
    if (m !== undefined && !VALID_MODELS.has(m)) {
      warnings.push(`unknown model "${m}" for agent "${agent.name}"`);
      console.warn(`Warning: unknown model "${m}" for agent "${agent.name}" — ignored`);
      agentModels[agent.name] = undefined;
    } else {
      agentModels[agent.name] = m;
    }
  }

  return { tmModel, agentModels };
}

/** Generate a 6-char hex deployment ID */
function generateDeployId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return "d-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Execute a resumed claude session in foreground-like modes (direct, interactive, foreground).
 * Shared logic extracted from 3 identical exec blocks.
 */
function executeResumedSession(opts: {
  sessionId: string;
  deployId: string;
  teamName: string;
  modelFlag: string;
  claudePrompt: string;
  cwd: string;
  deployEnv: NodeJS.ProcessEnv;
  runExtraction: () => void;
}): number {
  const { sessionId, deployId, teamName, modelFlag, claudePrompt, cwd, deployEnv, runExtraction } = opts;
  console.log(`Resuming deployment (foreground): ${teamName} [${deployId}]`);
  appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "pid", timestamp: localISOTimestamp(), pid: process.pid });
  let exitCode = 0;
  try {
    execSync(`claude --resume ${sessionId} ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
      stdio: "inherit",
      env: deployEnv,
      cwd,
    });
  } catch (err) {
    exitCode = (err as { status?: number }).status ?? 1;
    appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "crashed", timestamp: localISOTimestamp(), exit_code: exitCode });
  }
  runExtraction();
  writeFallbackIfNeeded(deployId, teamName);
  return exitCode;
}

/**
 * Resume a deployment by deploy-id.
 * Reconstructs the original claude session using the saved session JSONL path.
 */
function resumeDeployment(
  originalDeployId: string,
  opts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    direct?: boolean;
    teamModel?: string;
    agentModel?: string;
    timeout?: number;
  }
): void {
  const config = loadConfig();
  const paHome = getHomeDir();
  const dataDir = getDataDir();
  const logsDir = resolve(dataDir, "logs");
  const deploymentsDir = resolve(homedir(), "Documents/ai-usage/deployments");
  // Generate fresh deployment ID for the resumed deployment (ARCH-1)
  const deployId = generateDeployId();

  // Step 1: Read deployment from registry
  const status = queryDeploymentStatus(originalDeployId);
  if (!status) {
    console.error(`Error: Deployment not found: ${originalDeployId}`);
    process.exit(1);
  }

  // Step 2: Validate not currently running
  if (status.status === "running" && status.pid !== undefined) {
    if (isProcessAlive(status.pid)) {
      console.error(`Error: Deployment still running: ${originalDeployId} (PID ${status.pid})`);
      process.exit(1);
    }
    // PID is dead but status still running — proceed (edge case after crash)
  }

  // Step 3: Validate state is terminal
  const terminalStatuses = ["success", "partial", "failed", "crashed"];
  if (!terminalStatuses.includes(status.status)) {
    console.error(`Error: Deployment status is "${status.status}" — cannot resume. Expected a terminal status.`);
    process.exit(1);
  }

  // Step 4: Read session UUID from session-jsonl-path.txt
  const originalDeployDir = resolve(deploymentsDir, originalDeployId);
  const sessionPathFile = resolve(originalDeployDir, "session-jsonl-path.txt");
  if (!existsSync(sessionPathFile)) {
    console.error(`Error: Session data not found — cannot resume deployment ${originalDeployId}.`);
    console.error(`  Missing: ${sessionPathFile}`);
    process.exit(1);
  }
  const sessionJsonlPath = readFileSync(sessionPathFile, "utf-8").trim();
  if (!existsSync(sessionJsonlPath)) {
    console.error(`Error: Session data not found — cannot resume deployment ${originalDeployId}.`);
    console.error(`  Session file missing: ${sessionJsonlPath}`);
    process.exit(1);
  }

  // Step 5: Extract session UUID from path (last path segment without .jsonl)
  const sessionUuid = basename(sessionJsonlPath, ".jsonl");
  if (!sessionUuid) {
    console.error(`Error: Could not extract session UUID from path: ${sessionJsonlPath}`);
    process.exit(1);
  }

  // Step 6: Reconstruct env vars
  // activityLog goes to the NEW deployment directory
  const newDeployDir = resolve(deploymentsDir, deployId);
  const activityLog = resolve(newDeployDir, "activity.jsonl");
  const provider = status.provider ?? "anthropic";

  // Minimax env vars
  const minimaxBaseUrl = config.provider_defaults?.providers?.minimax?.base_url ?? FALLBACK_MINIMAX_BASE_URL;
  const minimaxApiKey = config.minimax_api_key;
  const minimaxModels = config.provider_defaults?.providers?.minimax?.models;
  const minimaxSonner = minimaxModels?.sonnet ?? FALLBACK_MINIMAX_MODEL;
  const minimaxOpus = minimaxModels?.opus ?? FALLBACK_MINIMAX_MODEL;
  const minimaxHaiku = minimaxModels?.haiku ?? FALLBACK_MINIMAX_MODEL;
  const minimaxEnv = provider === "minimax"
    ? {
        ANTHROPIC_BASE_URL: minimaxBaseUrl,
        ANTHROPIC_AUTH_TOKEN: minimaxApiKey ?? "",
        ANTHROPIC_MODEL: minimaxSonner,
        ANTHROPIC_SMALL_FAST_MODEL: minimaxHaiku,
        ANTHROPIC_DEFAULT_SONNET_MODEL: minimaxSonner,
        ANTHROPIC_DEFAULT_OPUS_MODEL: minimaxOpus,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: minimaxHaiku,
        DISABLE_PROMPT_CACHING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      }
    : {};

  // Determine mode (default to foreground)
  let mode: "foreground" | "background" | "dry-run" | "direct" | "interactive" = "foreground";
  if (opts.dryRun) mode = "dry-run";
  else if (opts.background) mode = "background";
  else if (opts.direct) mode = "direct";
  else if (opts.interactive) mode = "interactive";

  // Reconstruct model flag from registry models map (only for non-minimax)
  let modelFlag = "";
  if (provider !== "minimax" && status.models) {
    const tmModel = status.models["team-manager"];
    if (tmModel) {
      modelFlag = `--model ${tmModel}`;
    }
  }

  const deployEnv = {
    ...process.env,
    ...minimaxEnv,
    PA_DEPLOYMENT_ID: deployId,
    PA_DEPLOYMENT_DIR: newDeployDir,
    PA_ACTIVITY_LOG: activityLog,
    CLAUDECODE: undefined, // Strip nested-session detection
    ...(status.ticket_id ? { PA_TICKET_ID: status.ticket_id } : {}),
  };

  // Step 7: Write "started" event for the new resumed deployment (no UPDATE to original)
  // BUG-1 fix: original deployment stays terminal, new deployment gets fresh ID + lineage
  appendRegistryEvent({
    deployment_id: deployId,
    team: status.team,
    event: "started",
    timestamp: localISOTimestamp(),
    agents: status.agents,
    primer: status.primer,
    models: status.models,
    ticket_id: status.ticket_id,
    provider: status.provider,
    repo: status.repo,
    resumed_from_deployment_id: originalDeployId,
  });

  mkdirSync(logsDir, { recursive: true });

  // Step 8: Post-session content extraction script
  const extractScript = resolve(paHome, "scripts/extract-session-content.sh");
  const runExtraction = () => {
    if (!existsSync(extractScript)) return;
    try {
      execSync(`bash "${extractScript}"`, {
        env: deployEnv,
        stdio: ["pipe", "pipe", "inherit"],
        timeout: 30000,
      });
    } catch (err) {
      console.warn(`[extract] Post-session extraction failed: ${(err as Error).message}`);
    }
  };

  // Step 9: Build resume prompt
  const primerFile = resolve(originalDeployDir, "primer.md");
  if (!existsSync(primerFile)) {
    console.error(`Error: Primer not found for deployment ${originalDeployId}: ${primerFile}`);
    process.exit(1);
  }
  const claudePrompt = `Read the deployment primer at '${primerFile}' using the Read tool and follow ALL instructions in it exactly. Start immediately. When finished, write the completion marker and exit.`;

  if (mode === "dry-run") {
    console.log(`Resume deployment: ${deployId} (dry-run)`);
    console.log(`  Primer: ${primerFile}`);
    console.log(`  Session UUID: ${sessionUuid}`);
    return;
  }

  // DEDUP-1: Extract common exec+recovery logic into helper; CWD-1: restore repo_root for foreground modes
  const foregroundCwd = status.repo ? resolveRepo(status.repo).path : process.cwd();
  if (mode === "direct" || mode === "interactive" || mode === "foreground") {
    const exitCode = executeResumedSession({
      sessionId: sessionUuid,
      deployId,
      teamName: status.team,
      modelFlag,
      claudePrompt,
      cwd: foregroundCwd,
      deployEnv,
      runExtraction,
    });
    if (exitCode !== 0) process.exit(exitCode);
  } else {
    // Background mode
    const logFile = resolve(logsDir, `${status.team}-${deployId}.log`);
    console.log(`Resuming deployment (background): ${status.team} [${deployId}]`);
    console.log(`  Log: ${logFile}`);
    console.log("  Status: pa status");

    // Resolve timeout
    const maxRuntime = opts.timeout ?? DEFAULT_TIMEOUT;

    // Write log header
    const logHeader = `=== Resume Log ===
Deployment: ${deployId}
Team:       ${status.team}
Resumed:    ${localISOTimestamp()}
Mode:       resume
===
`;
    writeFileSync(logFile, logHeader);

    // Resolve bash path (NixOS compatibility)
    let bashPath: string;
    try {
      bashPath = execSync("command -v bash", { encoding: "utf-8" }).trim();
    } catch {
      bashPath = "/usr/bin/env bash";
    }

    // Write sensitive env vars to a file (mode 0o600)
    const envFile = resolve(originalDeployDir, "deploy.env");
    if (provider === "minimax") {
      const escapedKey = minimaxApiKey?.replace(/'/g, "'\\''") ?? "";
      const envContent = `export ANTHROPIC_BASE_URL='${minimaxBaseUrl}'
export ANTHROPIC_AUTH_TOKEN='${escapedKey}'
export ANTHROPIC_MODEL='${minimaxSonner}'
export ANTHROPIC_SMALL_FAST_MODEL='${minimaxHaiku}'
export ANTHROPIC_DEFAULT_SONNET_MODEL='${minimaxSonner}'
export ANTHROPIC_DEFAULT_OPUS_MODEL='${minimaxOpus}'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='${minimaxHaiku}'
export DISABLE_PROMPT_CACHING='1'
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
`;
      writeFileSync(envFile, envContent, { mode: 0o600 });
    }

    // Build background script
    const sourceEnv = provider === "minimax"
      ? `source '${envFile}' && rm -f '${envFile}'\n`
      : "";
    const bgScriptContent =
      sourceEnv +
      `unset CLAUDECODE
echo "[$(date -Iseconds)] claude resuming session..." >> "$PA_LOG_FILE"
stdbuf -oL timeout "$PA_MAX_RUNTIME" claude --resume ${sessionUuid} ${modelFlag} --dangerously-skip-permissions --print "$PA_CLAUDE_PROMPT" >> "$PA_LOG_FILE" 2>"$PA_LOG_FILE.err"
exit_code=$?
echo "" >> "$PA_LOG_FILE"
echo "[$(date -Iseconds)] claude exited with code $exit_code" >> "$PA_LOG_FILE"
if [[ -s "$PA_LOG_FILE.err" ]]; then
  echo "" >> "$PA_LOG_FILE"
  echo "=== STDERR ===" >> "$PA_LOG_FILE"
  cat "$PA_LOG_FILE.err" >> "$PA_LOG_FILE"
fi
rm -f "$PA_LOG_FILE.err"
# Post-session content extraction
if [[ -f "$PA_EXTRACT_SCRIPT" ]]; then
  echo "[$(date -Iseconds)] Running post-session extraction..." >> "$PA_LOG_FILE"
  bash "$PA_EXTRACT_SCRIPT" 2>> "$PA_LOG_FILE" || echo "[$(date -Iseconds)] Extraction failed (non-fatal)" >> "$PA_LOG_FILE"
fi
if [[ $exit_code -eq 124 ]]; then
  echo "[$(date -Iseconds)] TIMED OUT after $PA_MAX_RUNTIME s" >> "$PA_LOG_FILE"
  pa registry complete "$PA_DEPLOYMENT_ID" --status failed --summary "Timed out after $PA_MAX_RUNTIME s" 2>> "$PA_LOG_FILE" || true
elif [[ $exit_code -ne 0 ]]; then
  echo "[$(date -Iseconds)] claude exited with error code $exit_code" >> "$PA_LOG_FILE"
  pa registry complete "$PA_DEPLOYMENT_ID" --status failed --summary "Crashed with exit code $exit_code" 2>> "$PA_LOG_FILE" || true
fi
# Fallback: clean exit but no completion marker
if [[ $exit_code -eq 0 ]]; then
  pa registry complete "$PA_DEPLOYMENT_ID" --status partial --summary "Session ended without completion marker (fallback)" --fallback 2>> "$PA_LOG_FILE" || true
fi
`.trimStart();

    const bgScriptFile = resolve(originalDeployDir, "bg-runner.sh");
    writeFileSync(bgScriptFile, bgScriptContent + "\n", { mode: 0o700 });

    const bgScriptEnv = {
      ...deployEnv,
      PA_LOG_FILE: logFile,
      PA_MAX_RUNTIME: String(maxRuntime),
      PA_CLAUDE_PROMPT: claudePrompt,
      PA_EXTRACT_SCRIPT: extractScript,
    };

    const bgPid = spawnDetached("nohup", [bashPath, bgScriptFile], {
      cwd: status.repo ? resolveRepo(status.repo).path : process.cwd(),
      env: bgScriptEnv,
    });

    console.log(`  PID: ${bgPid}`);
    console.log(`  Timeout: ${maxRuntime}s`);

    appendRegistryEvent({
      deployment_id: deployId,
      team: status.team,
      event: "pid",
      timestamp: localISOTimestamp(),
      pid: bgPid,
    });
  }
}


/**
 * Write a fallback completion marker if no terminal event exists.
 * Called after execSync blocks in foreground-like modes (direct, interactive, foreground).
 */
function writeFallbackIfNeeded(deployId: string, teamName: string): void {
  const events = getDeploymentEvents(deployId);
  const hasTerminal = events.some(e => e.event === "completed" || e.event === "crashed");
  if (!hasTerminal) {
    appendRegistryEvent({
      deployment_id: deployId,
      team: teamName,
      event: "completed",
      timestamp: localISOTimestamp(),
      status: "partial",
      summary: "Session ended without completion marker (fallback)",
      fallback: true,
    });
    console.log(`[fallback] Wrote fallback completion marker for ${deployId}`);
  }
}

/** Resolve a relative path from PA_CONFIG first, then PA_HOME */
function makeResolver(configDir: string, homeDir: string) {
  return (relpath: string): string | undefined => {
    if (configDir) {
      const configPath = resolve(configDir, relpath);
      if (existsSync(configPath)) return configPath;
    }
    const homePath = resolve(homeDir, relpath);
    if (existsSync(homePath)) return homePath;
    return undefined;
  };
}

/** Print a formatted modes table. Used by --list-modes and invalid-mode error output. */
function printModesTable(teamName: string, modes: DeployMode[] | undefined): void {
  if (!modes || modes.length === 0) {
    console.log(`No modes configured for team: ${teamName}`);
    return;
  }
  console.log(`Modes for team: ${teamName}\n`);
  const rows = modes.map((m) => [
    m.id,
    m.label,
    m.phone_visible ? "yes" : "no",
    m.agents === undefined ? "all" : m.agents.length === 0 ? "(tm only)" : m.agents.join(", "),
    m.skills?.length ? m.skills.map(s => s.name).join(", ") : "—",
  ]);
  const headers = ["ID", "LABEL", "PHONE", "AGENTS", "SKILLS"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const pad = (s: string, w: number) => s.padEnd(w);
  console.log("  " + headers.map((h, i) => pad(h, widths[i])).join("  "));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log("  " + row.map((c, i) => pad(c, widths[i])).join("  "));
  }
}

/**
 * Deploy an agent team by generating a primer and running claude.
 * Replaces deploy.sh (342 lines).
 */
const VALID_PROVIDERS = new Set(["anthropic", "minimax"]);
// Hardcoded fallbacks — used when config.yaml does not specify overrides
const FALLBACK_MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
const FALLBACK_MINIMAX_MODEL = "MiniMax-M2.7";

export function deployCommand(
  spec: string,
  opts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    objective?: string;
    direct?: boolean;
    teamModel?: string;
    agentModel?: string;
    mode?: string;
    listModes?: boolean;
    repo?: string;
    ticket?: string;
    validate?: boolean;
    provider?: string;
    /** Override deployment timeout in seconds (default: 2700) */
    timeout?: number;
    /** Template variables to substitute in mode objective files */
    templateVars?: Record<string, string>;
    /** Resume a deployment by deploy-id */
    resume?: string;
  }
): void {
  // Handle --resume before any other logic
  if (opts.resume) {
    // Warn about mutually exclusive flags being ignored
    if (opts.objective) console.warn("Warning: --resume ignores --objective (using original deploy objective)");
    if (opts.mode) console.warn("Warning: --resume ignores --mode (using original deploy mode)");
    if (opts.ticket) console.warn("Warning: --resume ignores --ticket (using original deploy ticket)");
    if (opts.repo) console.warn("Warning: --resume ignores --repo (using original deploy repo)");
    if (opts.teamModel) console.warn("Warning: --resume ignores --team-model (model reconstructed from registry)");
    if (opts.agentModel) console.warn("Warning: --resume ignores --agent-model (model reconstructed from registry)");
    if (opts.provider) console.warn("Warning: --resume ignores --provider (using original deploy provider)");
    resumeDeployment(opts.resume, {
      dryRun: opts.dryRun,
      background: opts.background,
      interactive: opts.interactive,
      direct: opts.direct,
      teamModel: opts.teamModel,
      agentModel: opts.agentModel,
      timeout: opts.timeout,
    });
    return;
  }

  const config = loadConfig();
  const warnings: string[] = [];

  // Validate explicit --provider early (final resolution deferred until mode is known)
  if (opts.provider && !VALID_PROVIDERS.has(opts.provider)) {
    console.error(`Error: Invalid provider "${opts.provider}". Valid values: anthropic, minimax`);
    process.exit(1);
  }

  const paHome = getHomeDir();
  const dataDir = getDataDir();
  const primersDir = resolve(dataDir, "primers");
  const logsDir = resolve(dataDir, "logs");
  const deploymentsDir = resolve(homedir(), "Documents/ai-usage/deployments");
  const registryDb = getRegistryDbPath();

  const resolveFile = makeResolver(config.configDir, paHome);

  // Determine mode — foreground by default, --background for automated/timer use
  let mode: "background" | "dry-run" | "foreground" | "interactive" | "direct" = "foreground";
  if (opts.dryRun) mode = "dry-run";
  else if (opts.background) mode = "background";
  else if (opts.direct) mode = "direct";
  else if (opts.interactive) mode = "interactive";

  // Resolve team file: file path or name
  let teamFile: string;
  let teamName: string;

  if (existsSync(spec)) {
    // Absolute path to a YAML file — team name comes from YAML content, not filename
    teamFile = resolve(dirname(spec), basename(spec));
    teamName = ""; // resolved after parsing below
  } else {
    teamName = spec;
    const resolved = resolveFile(`teams/${teamName}.yaml`);
    if (!resolved) {
      console.error(`Error: Team not found: ${spec}`);
      if (config.configDir) {
        console.error(`  Searched: ${config.configDir}/teams/ and ${paHome}/teams/`);
      } else {
        console.error(`  Searched: ${paHome}/teams/`);
      }
      process.exit(1);
    }
    teamFile = resolved;
  }

  if (!existsSync(teamFile)) {
    console.error(`Error: Team file not found: ${teamFile}`);
    process.exit(1);
  }

  // Parse team YAML early — needed for mode validation before workspace creation
  const teamConfig = parseTeamYaml(teamFile);

  // Use YAML name field as canonical team name (overrides filename-derived name)
  if (!teamName) teamName = teamConfig.name || basename(teamFile, ".yaml");

  // Handle --list-modes: print modes table and exit
  if (opts.listModes) {
    printModesTable(teamConfig.name, teamConfig.deploy_modes);
    return;
  }

  // Handle --validate: check skill files, mode objective files, shared skills, and template vars without deploying
  if (opts.validate) {
    let allOk = true;
    const rows: Array<{ status: string; path: string; note: string }> = [];

    // Check each agent skill/instruction file
    for (const agent of teamConfig.agents) {
      // Check instruction field (new, preferred)
      if (agent.instruction) {
        const instPath = resolveFile(agent.instruction);
        if (instPath && existsSync(instPath)) {
          rows.push({ status: "OK", path: agent.instruction, note: `agent:${agent.name} instruction` });
        } else {
          rows.push({ status: "MISSING", path: agent.instruction, note: `agent:${agent.name} instruction` });
          allOk = false;
        }
      }
      // Also check deprecated skill field for backwards compat
      if (agent.skill) {
        const skillPath = resolveFile(agent.skill);
        if (skillPath && existsSync(skillPath)) {
          rows.push({ status: "OK", path: agent.skill, note: `agent:${agent.name} skill (deprecated)` });
        } else {
          rows.push({ status: "MISSING", path: agent.skill, note: `agent:${agent.name} skill (deprecated)` });
          allOk = false;
        }
      }
    }

    // Check shared skills from mode.skills[] (resolved from ~/.claude/skills/)
    const sharedSkillDirs = new Set<string>();
    for (const mode of teamConfig.deploy_modes ?? []) {
      if (mode.skills) {
        for (const skillEntry of mode.skills) {
          // Dedupe by skill name
          if (sharedSkillDirs.has(skillEntry.name)) continue;
          sharedSkillDirs.add(skillEntry.name);
          const skillPath = resolve(homedir(), ".claude/skills", skillEntry.name, "SKILL.md");
          if (existsSync(skillPath)) {
            rows.push({ status: "OK", path: `~/.claude/skills/${skillEntry.name}/SKILL.md`, note: `mode:${mode.id} shared-skill` });
          } else {
            rows.push({ status: "MISSING", path: `~/.claude/skills/${skillEntry.name}/SKILL.md`, note: `mode:${mode.id} shared-skill` });
            allOk = false;
          }
        }
      }
    }

    // Check each mode objective file
    const modes = teamConfig.deploy_modes ?? [];
    if (opts.mode !== undefined) {
      const singleMode = modes.find((m) => m.id === opts.mode);
      if (!singleMode) {
        console.error(`Error: Invalid mode "${opts.mode}" for team: ${teamConfig.name}`);
        printModesTable(teamConfig.name, modes);
        process.exit(1);
      }
    }
    for (const m of modes) {
      if (m.objective) {
        const objPath = resolveFile(m.objective);
        if (objPath && existsSync(objPath)) {
          rows.push({ status: "OK", path: m.objective, note: `mode:${m.id} objective` });
        } else {
          rows.push({ status: "MISSING", path: m.objective, note: `mode:${m.id} objective` });
          allOk = false;
        }
      }
    }

    // Generate primer with dummy vars and scan for unresolved template variables
    const dummyVars: Record<string, string> = {
      TODAY: "YYYY-MM-DD", YEAR: "YYYY", MONTH: "MM",
      HOME: "/home/user", TEAM_NAME: teamName, MODE_ID: opts.mode ?? "",
      DEPLOY_ID: "d-000000", OUTPUT_DIR: "/home/user/Documents/ai-usage/output",
      REPO_KEY: "repo",
    };
    const { content: primerForValidation, warnings: primerWarningsForValidation } = generatePrimer({
      deployId: "d-000000",
      teamName,
      teamConfig,
      teamFile,
      deployTs: new Date().toISOString(),
      registryDb,
      deploymentsDir,
      deployMode: opts.mode,
      cwd: process.cwd(),
      repoRoot: undefined,
      resolveFile,
      configDir: config.configDir,
      homeDir: paHome,
      effectiveModels: undefined,
      templateVars: dummyVars,
    });
    warnings.push(...primerWarningsForValidation);
    const unresolvedMatches = primerForValidation.match(/\{\{[A-Z_]+\}\}/g);
    const unresolved = [...new Set(unresolvedMatches ?? [])];

    // Print summary
    console.log(`\nValidation: ${teamConfig.name}`);
    console.log(`${"─".repeat(60)}`);
    const statusWidth = 7;
    const noteWidth = 30;
    for (const row of rows) {
      const s = row.status.padEnd(statusWidth);
      const n = row.note.padEnd(noteWidth);
      console.log(`  ${s}  ${n}  ${row.path}`);
    }
    if (unresolved.length > 0) {
      console.log(`\n  WARN    Unresolved template variables:`);
      for (const v of unresolved) {
        console.log(`           ${v}`);
      }
      allOk = false;
    }
    console.log(`\n${allOk ? "  ✓ All checks passed." : "  ✗ Validation failed — see MISSING/WARN above."}`);
    process.exit(allOk ? 0 : 1);
  }

  // Validate --mode before workspace creation, primer generation, or registry write
  if (opts.mode !== undefined) {
    const modes = teamConfig.deploy_modes;
    if (!modes || modes.length === 0) {
      console.error(`Error: No modes configured for team: ${teamConfig.name}`);
      process.exit(1);
    }
    const validMode = modes.find((m) => m.id === opts.mode);
    if (!validMode) {
      console.error(`Error: Invalid mode "${opts.mode}" for team: ${teamConfig.name}`);
      printModesTable(teamConfig.name, modes);
      process.exit(1);
    }
  }

  // Validate --direct: warn if --direct used but no direct mode configured
  if (opts.direct) {
    const modes = teamConfig.deploy_modes;
    if (modes && modes.length > 0 && !modes.find((m) => m.id === "direct")) {
      warnings.push("--direct used but team has no direct deploy mode");
      console.warn("Warning: --direct used but team has no direct deploy mode — falling back to default mode behavior");
    }
  }

  // Resolve effective provider: explicit --provider > mode-level provider > config default > "anthropic"
  const effectiveModeId = opts.mode ?? teamConfig.default_mode;
  const modeProvider = teamConfig.deploy_modes?.find((m) => m.id === effectiveModeId)?.provider;
  const configDefaultProvider = config.provider_defaults?.default_provider;
  const provider = opts.provider ?? modeProvider ?? configDefaultProvider ?? "anthropic";
  if (!VALID_PROVIDERS.has(provider)) {
    console.error(`Error: Invalid provider "${provider}" from mode "${effectiveModeId}". Valid values: anthropic, minimax`);
    process.exit(1);
  }

  // Fail-fast if Minimax API key is missing
  if (provider === "minimax" && !config.minimax_api_key) {
    console.error(`Error: provider minimax requires minimax_api_key in config.yaml`);
    console.error(`  Config file: ~/.config/sinh-x/personal-assistant/config.yaml`);
    console.error(`  Add: minimax_api_key: <your-key>`);
    process.exit(1);
  }
  const minimaxApiKey = config.minimax_api_key;
  if (provider !== "anthropic") console.log(`  Provider: ${provider}`);

  // Bulletin guard — block deployment if an active bulletin targets this team.
  // Skipped in dry-run mode so users can still preview primers when blocked.
  if (mode !== "dry-run") {
    const guard = isTeamBlocked(teamName);
    if (guard.blocked) {
      const b = guard.bulletin!;
      const blockStr = b.block === "all" ? "all teams" : `team "${teamName}"`;
      console.error(`\nDeployment blocked: active bulletin [${b.id}] "${b.title}"`);
      console.error(`  Blocks: ${blockStr}`);
      if (b.except.length > 0) console.error(`  Exempt: ${b.except.join(", ")}`);
      if (b.body) console.error(`\n${b.body}\n`);
      console.error(`\nTo unblock: pa bulletin resolve ${b.id}`);
      process.exit(1);
    }
  }

  // Validate ticket if provided — fail fast before any workspace/primer/registry work
  if (opts.ticket) {
    const store = new TicketStore();
    const ticket = store.get(opts.ticket);
    if (!ticket) {
      console.error(`Error: Ticket ${opts.ticket} not found. Check the ticket ID and try again.`);
      process.exit(1);
    } else {
      const validStatuses = ["pending-implementation", "implementing", "requirement-review"];
      if (!validStatuses.includes(ticket.status)) {
        warnings.push(`Ticket ${opts.ticket} has status "${ticket.status}"`);
        console.error(`Warning: Ticket ${opts.ticket} has status "${ticket.status}" (expected one of: ${validStatuses.join(", ")}). Verify this is the right ticket.`);
      }
      if (ticket.assignee && !ticket.assignee.startsWith(teamName) && ticket.assignee !== "sinh") {
        warnings.push(`Ticket ${opts.ticket} is assigned to "${ticket.assignee}"`);
        console.error(`Warning: Ticket ${opts.ticket} is assigned to "${ticket.assignee}", not "${teamName}". Verify team alignment.`);
      }
    }
  }

  // Handle --repo all: spawn one deployment per repo that has a prefix field
  if (opts.repo === "all") {
    const allRepos = listRepos().filter((r) => r.prefix);
    console.log(`Deploying routine for ${allRepos.length} repos with ticket prefixes...`);
    for (const repo of allRepos) {
      console.log(`Deploying routine for repo: ${repo.name} [${repo.prefix}]`);
      deployCommand(spec, { ...opts, repo: repo.name });
    }
    return;
  }

  mkdirSync(primersDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(deploymentsDir, { recursive: true });

  // Generate deployment ID and timestamp
  const deployId = generateDeployId();
  const deployTs = localISOTimestamp();

  // Create workspace base
  const deployDir = resolve(deploymentsDir, deployId);
  mkdirSync(deployDir, { recursive: true });

  // PA-1020: Write objective to file for file-based objective passing
  let objectiveFile: string | undefined;
  if (opts.objective) {
    objectiveFile = resolve(deployDir, "objective.md");
    writeFileSync(objectiveFile, opts.objective, "utf-8");
  }

  // If running inside a parent PA deployment, write child_deployment event to parent's log
  const parentActivityLog = process.env["PA_ACTIVITY_LOG"];
  if (parentActivityLog) {
    const childEvent = JSON.stringify({
      ts: new Date().toISOString(),
      deploy_id: process.env["PA_DEPLOYMENT_ID"] ?? "unknown",
      agent: "main",
      event: "child_deployment",
      data: { child_deploy_id: deployId, team: teamName },
    });
    appendFileSync(parentActivityLog, childEvent + "\n");
  }

  const agentNames = teamConfig.agents.map((a) => a.name);

  // Detect git repo root from cwd (for repo-aware agents)
  let cwd = process.cwd();
  let repoRoot: string | undefined;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
  } catch {
    repoRoot = undefined;
  }

  // Override cwd/repoRoot if --repo is specified
  if (opts.repo) {
    const resolved = resolveRepo(opts.repo);
    cwd = resolved.path;
    repoRoot = resolved.path;
  }

  // Look up RepoEntry after repoRoot resolution to get prefix, developBranch, mainBranch
  // Compute repo-aware template vars to pass to primer generation
  let repoTemplateVars: Record<string, string> = {};
  if (repoRoot) {
    const allRepos = listRepos();
    const repoEntry = allRepos.find((r) => r.path === repoRoot);
    if (repoEntry) {
      const ghRepo = resolveGhRepo(repoRoot);
      repoTemplateVars = {
        ...(repoEntry.prefix ? { PROJECT_PREFIX: repoEntry.prefix } : {}),
        ...(ghRepo ? { GH_REPO: ghRepo } : {}),
        DEVELOP_BRANCH: repoEntry.developBranch ?? "develop",
        MAIN_BRANCH: repoEntry.mainBranch ?? "main",
      };
    }
  }

  // Resolve effective models — always call resolveEffectiveModels to populate tmModel/agentModels
  // regardless of provider. modelFlag is only set for non-minimax (minimax uses ANTHROPIC_MODEL env var)
  const { tmModel, agentModels } = resolveEffectiveModels(teamConfig, {
    teamModel: opts.teamModel,
    agentModel: opts.agentModel,
    modeModel: teamConfig.deploy_modes?.find((m) => m.id === (opts.mode ?? teamConfig.default_mode))?.model,
  }, warnings);
  const modelFlag = provider === "minimax" ? "" : (tmModel ? `--model ${tmModel}` : "");

  // Deployment env vars passed to claude so hooks can locate the activity log.
  // PA_ACTIVITY_LOG must be set here directly — CLAUDE_ENV_FILE only propagates
  // to Bash tool calls, not to hook scripts.
  const activityLog = resolve(deployDir, "activity.jsonl");
  const minimaxBaseUrl = config.provider_defaults?.providers?.minimax?.base_url ?? FALLBACK_MINIMAX_BASE_URL;
  const minimaxModels = config.provider_defaults?.providers?.minimax?.models;
  const minimaxSonner = minimaxModels?.sonnet ?? FALLBACK_MINIMAX_MODEL;
  const minimaxOpus = minimaxModels?.opus ?? FALLBACK_MINIMAX_MODEL;
  const minimaxHaiku = minimaxModels?.haiku ?? FALLBACK_MINIMAX_MODEL;
  const minimaxEnv = provider === "minimax"
    ? {
        ANTHROPIC_BASE_URL: minimaxBaseUrl,
        ANTHROPIC_AUTH_TOKEN: minimaxApiKey ?? "",
        ANTHROPIC_MODEL: minimaxSonner,
        ANTHROPIC_SMALL_FAST_MODEL: minimaxHaiku,
        ANTHROPIC_DEFAULT_SONNET_MODEL: minimaxSonner,
        ANTHROPIC_DEFAULT_OPUS_MODEL: minimaxOpus,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: minimaxHaiku,
        DISABLE_PROMPT_CACHING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      }
    : {};
  const deployEnv = {
    ...process.env,
    ...minimaxEnv,
    PA_DEPLOYMENT_ID: deployId,
    PA_DEPLOYMENT_DIR: deployDir,
    PA_ACTIVITY_LOG: activityLog,
    CLAUDECODE: undefined, // Strip nested-session detection from child processes
    ...(opts.ticket ? { PA_TICKET_ID: opts.ticket } : {}),
  };

  // Generate primer
  const primerFile = resolve(primersDir, `${teamName}-${deployId}-primer.md`);
  const { content: primerContent, warnings: primerWarnings } = generatePrimer({
    deployId,
    teamName,
    teamConfig,
    teamFile,
    deployTs,
    registryDb,
    deploymentsDir,
    extraObjective: opts.objective,
    deployMode: opts.mode ?? (opts.direct ? "direct" : undefined),
    cwd,
    repoRoot,
    resolveFile,
    configDir: config.configDir,
    homeDir: paHome,
    effectiveModels: { tmModel, agentModels },
    templateVars: { ...repoTemplateVars, ...opts.templateVars },
    ticket: opts.ticket,
  });
  warnings.push(...primerWarnings);
  writeFileSync(primerFile, primerContent);
  copyFileSync(primerFile, resolve(deployDir, "primer.md"));
  console.log(`Primer generated: ${primerFile}`);

  // Write warnings to warnings.log if any warnings were collected
  if (warnings.length > 0) {
    writeFileSync(resolve(deployDir, "warnings.log"), warnings.join("\n") + "\n");
  }

  // Dry run — print primer and exit
  if (mode === "dry-run") {
    console.log("--- DRY RUN — primer content: ---");
    process.stdout.write(readFileSync(primerFile, "utf-8"));
    return;
  }

  // Build models map for registry (only include if any model is set)
  const modelsMap: Record<string, string> = {};
  if (tmModel) modelsMap["team-manager"] = tmModel;
  for (const [name, m] of Object.entries(agentModels)) {
    if (m) modelsMap[name] = m;
  }
  const anyModelSet = Object.keys(modelsMap).length > 0;

  // Derive repo name: opts.repo takes precedence, else basename of repoRoot
  const repoName = opts.repo ?? (repoRoot ? basename(repoRoot) : undefined);

  // Write start event to registry
  const startEvent: RegistryEvent = {
    deployment_id: deployId,
    team: teamName,
    event: "started",
    timestamp: deployTs,
    agents: agentNames,
    primer: primerFile,
    ...(anyModelSet ? { models: modelsMap } : {}),
    ...(opts.ticket ? { ticket_id: opts.ticket } : {}),
    ...(objectiveFile ? { objectiveFile } : {}),
    ...(repoName ? { repo: repoName } : {}),
    provider,
  };
  appendRegistryEvent(startEvent);

  // Build claude command
  const claudePrompt = `Read the deployment primer at '${primerFile}' using the Read tool and follow ALL instructions in it exactly. Start immediately. When finished, write the completion marker and exit.`;

  // Post-session content extraction: thinking, text, tool_use_detail → activity.jsonl
  const extractScript = resolve(paHome, "scripts/extract-session-content.sh");
  const runExtraction = () => {
    if (!existsSync(extractScript)) return;
    try {
      execSync(`bash "${extractScript}"`, {
        env: deployEnv,
        stdio: ["pipe", "pipe", "inherit"],
        timeout: 30000,
      });
    } catch (err) {
      console.warn(`[extract] Post-session extraction failed: ${(err as Error).message}`);
    }
  };

  if (mode === "direct") {
    console.log(`Deploying team (direct): ${teamConfig.name} [${deployId}]`);
    appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "pid", timestamp: localISOTimestamp(), pid: process.pid });
    let exitCode = 0;
    try {
      execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
        stdio: "inherit",
        env: deployEnv,
      });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
      appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "crashed", timestamp: localISOTimestamp(), exit_code: exitCode });
    }
    runExtraction();
    writeFallbackIfNeeded(deployId, teamName);
    if (exitCode !== 0) process.exit(exitCode);
  } else if (mode === "interactive") {
    console.log(`Deploying team (interactive): ${teamConfig.name} [${deployId}]`);
    console.log("  You will be prompted to approve tool calls.");
    appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "pid", timestamp: localISOTimestamp(), pid: process.pid });
    let exitCode = 0;
    try {
      execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
        stdio: "inherit",
        env: deployEnv,
      });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
      appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "crashed", timestamp: localISOTimestamp(), exit_code: exitCode });
    }
    runExtraction();
    writeFallbackIfNeeded(deployId, teamName);
    if (exitCode !== 0) process.exit(exitCode);
  } else if (mode === "foreground") {
    console.log(`Deploying team (foreground): ${teamConfig.name} [${deployId}]`);
    appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "pid", timestamp: localISOTimestamp(), pid: process.pid });
    let exitCode = 0;
    try {
      execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
        stdio: "inherit",
        env: deployEnv,
      });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
      appendRegistryEvent({ deployment_id: deployId, team: teamName, event: "crashed", timestamp: localISOTimestamp(), exit_code: exitCode });
    }
    runExtraction();
    writeFallbackIfNeeded(deployId, teamName);
    if (exitCode !== 0) process.exit(exitCode);
  } else {
    // Background mode
    const logFile = resolve(logsDir, `${teamName}-${deployId}.log`);
    console.log(`Deploying team (background): ${teamConfig.name} [${deployId}]`);
    console.log(`  Log: ${logFile}`);
    console.log("  Status: pa status");

    // Resolve timeout with precedence: PA_MAX_RUNTIME env var > --timeout CLI > mode.timeout > teamConfig.timeout > 2700
    const modeTimeout = teamConfig.deploy_modes?.find((m) => m.id === effectiveModeId)?.timeout;
    const teamTimeout = teamConfig.timeout;

    // Check bounds on YAML values early so we fail before spawning
    const yamlTimeoutErr = validateTimeout(teamTimeout, "team config");
    if (yamlTimeoutErr) {
      console.error(`Error: team config timeout ${yamlTimeoutErr}`);
      process.exit(1);
    }
    const yamlModeTimeoutErr = validateTimeout(modeTimeout, "mode config");
    if (yamlModeTimeoutErr) {
      console.error(`Error: mode config timeout ${yamlModeTimeoutErr}`);
      process.exit(1);
    }
    const cliTimeoutErr = validateTimeout(opts.timeout, "CLI flag");
    if (cliTimeoutErr) {
      console.error(`Error: ${cliTimeoutErr}`);
      process.exit(1);
    }

    // Apply precedence
    let maxRuntime: number;
    if (process.env["PA_MAX_RUNTIME"]) {
      maxRuntime = parseInt(process.env["PA_MAX_RUNTIME"]!, 10);
    } else if (opts.timeout !== undefined) {
      maxRuntime = opts.timeout;
    } else if (modeTimeout !== undefined) {
      maxRuntime = modeTimeout;
    } else if (teamTimeout !== undefined) {
      maxRuntime = teamTimeout;
    } else {
      maxRuntime = DEFAULT_TIMEOUT;
    }

    // Write log header
    const logHeader = `=== Deployment Log ===
Deployment: ${deployId}
Team:       ${teamName}
Started:    ${deployTs}
Timeout:    ${maxRuntime}s
Primer:     ${primerFile}
Agents:     ${agentNames.join(" ")}
===

`;
    writeFileSync(logFile, logHeader);

    // Resolve bash path (NixOS compatibility)
    let bashPath: string;
    try {
      bashPath = execSync("command -v bash", { encoding: "utf-8" }).trim();
    } catch {
      bashPath = "/usr/bin/env bash";
    }

    // Write sensitive env vars to a file (mode 0o600) — sourced and deleted by bgScript
    const envFile = resolve(deployDir, "deploy.env");
    if (provider === "minimax") {
      const escapedKey = minimaxApiKey?.replace(/'/g, "'\\''") ?? "";
      const envContent = `export ANTHROPIC_BASE_URL='${minimaxBaseUrl}'
export ANTHROPIC_AUTH_TOKEN='${escapedKey}'
export ANTHROPIC_MODEL='${minimaxSonner}'
export ANTHROPIC_SMALL_FAST_MODEL='${minimaxHaiku}'
export ANTHROPIC_DEFAULT_SONNET_MODEL='${minimaxSonner}'
export ANTHROPIC_DEFAULT_OPUS_MODEL='${minimaxOpus}'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='${minimaxHaiku}'
export DISABLE_PROMPT_CACHING='1'
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
`;
      writeFileSync(envFile, envContent, { mode: 0o600 });
    }


    // Build background script — uses env vars exclusively (no inline interpolation)
    // so that objectives with quotes/metacharacters cannot break the shell command.
    const sourceEnv = provider === "minimax"
      ? `source '${envFile}' && rm -f '${envFile}'\n`
      : "";
    const bgScriptContent =
      sourceEnv +
      `unset CLAUDECODE
echo "[$(date -Iseconds)] claude starting..." >> "$PA_LOG_FILE"
stdbuf -oL timeout "$PA_MAX_RUNTIME" claude ${modelFlag ? modelFlag + " " : ""}--dangerously-skip-permissions --print "$PA_CLAUDE_PROMPT" >> "$PA_LOG_FILE" 2>"$PA_LOG_FILE.err"
exit_code=$?
echo "" >> "$PA_LOG_FILE"
echo "[$(date -Iseconds)] claude exited with code $exit_code" >> "$PA_LOG_FILE"
if [[ -s "$PA_LOG_FILE.err" ]]; then
  echo "" >> "$PA_LOG_FILE"
  echo "=== STDERR ===" >> "$PA_LOG_FILE"
  cat "$PA_LOG_FILE.err" >> "$PA_LOG_FILE"
fi
rm -f "$PA_LOG_FILE.err"
# Post-session content extraction (thinking/text/tool_use_detail → activity.jsonl)
if [[ -f "$PA_EXTRACT_SCRIPT" ]]; then
  echo "[$(date -Iseconds)] Running post-session extraction..." >> "$PA_LOG_FILE"
  bash "$PA_EXTRACT_SCRIPT" 2>> "$PA_LOG_FILE" || echo "[$(date -Iseconds)] Extraction failed (non-fatal)" >> "$PA_LOG_FILE"
fi
if [[ $exit_code -eq 124 ]]; then
  echo "[$(date -Iseconds)] TIMED OUT after $PA_MAX_RUNTIME s" >> "$PA_LOG_FILE"
  pa registry complete "$PA_DEPLOYMENT_ID" --status failed --summary "Timed out after $PA_MAX_RUNTIME s" 2>> "$PA_LOG_FILE" || true
elif [[ $exit_code -ne 0 ]]; then
  echo "[$(date -Iseconds)] claude exited with error code $exit_code" >> "$PA_LOG_FILE"
  pa registry complete "$PA_DEPLOYMENT_ID" --status failed --summary "Crashed with exit code $exit_code" 2>> "$PA_LOG_FILE" || true
fi
# Fallback: clean exit but no completion marker
if [[ $exit_code -eq 0 ]]; then
  pa registry complete "$PA_DEPLOYMENT_ID" --status partial --summary "Session ended without completion marker (fallback)" --fallback 2>> "$PA_LOG_FILE" || true
fi
`.trimStart();

    // Write bgScript to temp file and execute from there (no inline interpolation)
    const bgScriptFile = resolve(deployDir, "bg-runner.sh");
    writeFileSync(bgScriptFile, bgScriptContent + "\n", { mode: 0o700 });

    // Build env for background script — extends deployEnv with script-specific vars
    const bgScriptEnv = {
      ...deployEnv,
      PA_LOG_FILE: logFile,
      PA_MAX_RUNTIME: String(maxRuntime),
      PA_CLAUDE_PROMPT: claudePrompt,
      PA_EXTRACT_SCRIPT: extractScript,
    };

    // Spawn background process via nohup — runs the script file, not inline string
    const bgPid = spawnDetached("nohup", [bashPath, bgScriptFile], {
      cwd,
      env: bgScriptEnv,
    });

    console.log(`  PID: ${bgPid}`);
    console.log(`  Timeout: ${maxRuntime}s`);

    // Write PID event
    const pidEvent: RegistryEvent = {
      deployment_id: deployId,
      team: teamName,
      event: "pid",
      timestamp: deployTs,
      pid: bgPid,
    };
    appendRegistryEvent(pidEvent);
  }
}
