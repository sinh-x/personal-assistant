import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, copyFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getHomeDir, getDataDir, getRegistryDbPath } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
import { appendRegistryEvent } from "../lib/registry.js";
import { generatePrimer, resolveGhRepo } from "../lib/primer.js";
import { resolveRepo, listRepos } from "../lib/repos.js";
import { isTeamBlocked } from "../lib/bulletins/index.js";
import { TicketStore } from "../lib/tickets/store.js";
import { spawnDetached } from "../utils/process.js";
import { localISOTimestamp } from "../lib/time.js";
import type { DeployMode, RegistryEvent, TeamConfig } from "../lib/types.js";

const VALID_MODELS = new Set(["haiku", "sonnet", "opus"]);

/** Resolve effective model for team-manager and each agent, applying Sonnet floor and validation */
function resolveEffectiveModels(
  teamConfig: TeamConfig,
  opts: { teamModel?: string; agentModel?: string; modeModel?: string }
): { tmModel: string | undefined; agentModels: Record<string, string | undefined> } {
  // Precedence: explicit --team-model CLI flag > per-mode YAML model > team-level YAML model
  let tmModel: string | undefined = opts.teamModel ?? opts.modeModel ?? teamConfig.model ?? undefined;
  if (tmModel === "haiku") {
    console.log('Warning: team-manager model "haiku" upgraded to "sonnet" (minimum floor)');
    tmModel = "sonnet";
  }
  if (tmModel !== undefined && !VALID_MODELS.has(tmModel)) {
    console.warn(`Warning: unknown model "${tmModel}" for team-manager — ignored`);
    tmModel = undefined;
  }

  const agentModels: Record<string, string | undefined> = {};
  for (const agent of teamConfig.agents) {
    const m = opts.agentModel ?? agent.model ?? teamConfig.model ?? undefined;
    if (m !== undefined && !VALID_MODELS.has(m)) {
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
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_MODEL = "MiniMax-M2.7";

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
    /** Template variables to substitute in mode objective files */
    templateVars?: Record<string, string>;
  }
): void {
  const config = loadConfig();

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
    const primerForValidation = generatePrimer({
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
      console.warn("Warning: --direct used but team has no direct deploy mode — falling back to default mode behavior");
    }
  }

  // Resolve effective provider: explicit --provider > mode-level provider > "anthropic"
  const effectiveModeId = opts.mode ?? teamConfig.default_mode;
  const modeProvider = teamConfig.deploy_modes?.find((m) => m.id === effectiveModeId)?.provider;
  const provider = opts.provider ?? modeProvider ?? "anthropic";
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
        console.error(`Warning: Ticket ${opts.ticket} has status "${ticket.status}" (expected one of: ${validStatuses.join(", ")}). Verify this is the right ticket.`);
      }
      if (ticket.assignee && !ticket.assignee.startsWith(teamName) && ticket.assignee !== "sinh") {
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
  });
  const modelFlag = provider === "minimax" ? "" : (tmModel ? `--model ${tmModel}` : "");

  // Deployment env vars passed to claude so hooks can locate the activity log.
  // PA_ACTIVITY_LOG must be set here directly — CLAUDE_ENV_FILE only propagates
  // to Bash tool calls, not to hook scripts.
  const activityLog = resolve(deployDir, "activity.jsonl");
  const minimaxEnv = provider === "minimax"
    ? {
        ANTHROPIC_BASE_URL: MINIMAX_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: minimaxApiKey ?? "",
        ANTHROPIC_MODEL: MINIMAX_MODEL,
        ANTHROPIC_SMALL_FAST_MODEL: MINIMAX_MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MINIMAX_MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MINIMAX_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: MINIMAX_MODEL,
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
  const primerContent = generatePrimer({
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
  writeFileSync(primerFile, primerContent);
  copyFileSync(primerFile, resolve(deployDir, "primer.md"));
  console.log(`Primer generated: ${primerFile}`);

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
    ...(opts.objective ? { objective: opts.objective } : {}),
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
    if (exitCode !== 0) process.exit(exitCode);
  } else {
    // Background mode
    const logFile = resolve(logsDir, `${teamName}-${deployId}.log`);
    console.log(`Deploying team (background): ${teamConfig.name} [${deployId}]`);
    console.log(`  Log: ${logFile}`);
    console.log("  Status: pa status");

    const maxRuntime = process.env["PA_MAX_RUNTIME"] ?? "1800";

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
      const envContent = `export ANTHROPIC_BASE_URL='${MINIMAX_BASE_URL}'
export ANTHROPIC_AUTH_TOKEN='${escapedKey}'
export ANTHROPIC_MODEL='${MINIMAX_MODEL}'
export ANTHROPIC_SMALL_FAST_MODEL='${MINIMAX_MODEL}'
export ANTHROPIC_DEFAULT_SONNET_MODEL='${MINIMAX_MODEL}'
export ANTHROPIC_DEFAULT_OPUS_MODEL='${MINIMAX_MODEL}'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='${MINIMAX_MODEL}'
export DISABLE_PROMPT_CACHING='1'
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
`;
      writeFileSync(envFile, envContent, { mode: 0o600 });
    }

    // Pre-write crash JSON files before bgScriptContent evaluation (avoids inline JSON construction in shell)
    const crashTimeoutJson = resolve(deployDir, "crash-timeout.json");
    const crashErrorJson = resolve(deployDir, "crash-error.json");
    writeFileSync(crashTimeoutJson, JSON.stringify({
      deployment_id: deployId,
      team: teamName,
      event: "crashed",
      timestamp: new Date().toISOString(),
      exit_code: 124,
      summary: `Timed out after ${maxRuntime}s`,
    }));
    writeFileSync(crashErrorJson, JSON.stringify({
      deployment_id: deployId,
      team: teamName,
      event: "crashed",
      timestamp: new Date().toISOString(),
      exit_code: 0,
    }));

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
  { flock -w 5 9; cat '${crashTimeoutJson}' >> "$PA_REGISTRY_FILE"; } 9>"$PA_REGISTRY_LOCK"
elif [[ $exit_code -ne 0 ]]; then
  { flock -w 5 9; cat '${crashErrorJson}' >> "$PA_REGISTRY_FILE"; } 9>"$PA_REGISTRY_LOCK"
fi
`.trimStart();

    // Write bgScript to temp file and execute from there (no inline interpolation)
    const bgScriptFile = resolve(deployDir, "bg-runner.sh");
    writeFileSync(bgScriptFile, bgScriptContent + "\n", { mode: 0o700 });

    // Build env for background script — extends deployEnv with script-specific vars
    const bgScriptEnv = {
      ...deployEnv,
      PA_LOG_FILE: logFile,
      PA_MAX_RUNTIME: maxRuntime,
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
