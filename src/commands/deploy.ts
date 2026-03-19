import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getHomeDir, getDataDir, getRegistryPath, getRegistryLockPath } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
import { appendRegistryEvent } from "../lib/registry.js";
import { generatePrimer } from "../lib/primer.js";
import { spawnDetached } from "../utils/process.js";
import { resolveRepo } from "../lib/repos.js";
import type { RegistryEvent, TeamConfig } from "../lib/types.js";

const VALID_MODELS = new Set(["haiku", "sonnet", "opus"]);

/** Resolve effective model for team-manager and each agent, applying Sonnet floor and validation */
function resolveEffectiveModels(
  teamConfig: TeamConfig,
  opts: { teamModel?: string; agentModel?: string }
): { tmModel: string | undefined; agentModels: Record<string, string | undefined> } {
  let tmModel: string | undefined = opts.teamModel ?? teamConfig.model ?? undefined;
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

/** Generate an ISO timestamp in local time with timezone offset (matches `date -Iseconds`) */
function localISOTimestamp(): string {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${hh}:${mm}`;
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

/**
 * Deploy an agent team by generating a primer and running claude.
 * Replaces deploy.sh (342 lines).
 */
export function deployCommand(
  spec: string,
  opts: {
    dryRun?: boolean;
    background?: boolean;
    interactive?: boolean;
    objective?: string;
    routeDecisions?: boolean;
    direct?: boolean;
    teamModel?: string;
    agentModel?: string;
    mode?: string;
    listModes?: boolean;
    repo?: string;
  }
): void {
  const config = loadConfig();
  const paHome = getHomeDir();
  const dataDir = getDataDir();
  const primersDir = resolve(dataDir, "primers");
  const logsDir = resolve(dataDir, "logs");
  const deploymentsDir = resolve(homedir(), "Documents/ai-usage/deployments");
  const registryFile = getRegistryPath();
  const registryLock = getRegistryLockPath();

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

  // Parse team YAML
  const teamConfig = parseTeamYaml(teamFile);

  // Handle --list-modes: print modes table and exit
  if (opts.listModes) {
    const modes = teamConfig.deploy_modes;
    if (!modes || modes.length === 0) {
      console.log(`No modes configured for team: ${teamConfig.name}`);
      return;
    }
    console.log(`Modes for team: ${teamConfig.name}\n`);
    const rows = modes.map((m) => [
      m.id,
      m.label,
      m.phone_visible ? "yes" : "no",
      m.agents === undefined ? "all" : m.agents.length === 0 ? "(tm only)" : m.agents.join(", "),
      m.skills?.join(", ") ?? "—",
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
    return;
  }

  const agentNames = teamConfig.agents.map((a) => a.name);

  // Use YAML name field as canonical team name (overrides filename-derived name)
  if (!teamName) teamName = teamConfig.name || basename(teamFile, ".yaml");

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

  // Resolve effective models
  const { tmModel, agentModels } = resolveEffectiveModels(teamConfig, {
    teamModel: opts.teamModel,
    agentModel: opts.agentModel,
  });
  const modelFlag = tmModel ? `--model ${tmModel}` : "";

  // Deployment env vars passed to claude so hooks can locate the activity log.
  // PA_ACTIVITY_LOG must be set here directly — CLAUDE_ENV_FILE only propagates
  // to Bash tool calls, not to hook scripts.
  const activityLog = resolve(deployDir, "activity.jsonl");
  const deployEnv = {
    ...process.env,
    PA_DEPLOYMENT_ID: deployId,
    PA_DEPLOYMENT_DIR: deployDir,
    PA_ACTIVITY_LOG: activityLog,
  };

  // Generate primer
  const primerFile = resolve(primersDir, `${teamName}-${deployId}-primer.md`);
  const primerContent = generatePrimer({
    deployId,
    teamName,
    teamConfig,
    teamFile,
    deployTs,
    registryFile,
    registryLock,
    deploymentsDir,
    extraObjective: opts.objective,
    deployMode: opts.mode ?? (opts.routeDecisions ? "route-decisions" : opts.direct ? "direct" : undefined),
    cwd,
    repoRoot,
    resolveFile,
    configDir: config.configDir,
    homeDir: paHome,
    effectiveModels: { tmModel, agentModels },
  });
  writeFileSync(primerFile, primerContent);
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

  // Write start event to registry
  const startEvent: RegistryEvent = {
    deployment_id: deployId,
    team: teamName,
    event: "started",
    timestamp: deployTs,
    agents: agentNames,
    primer: primerFile,
    ...(anyModelSet ? { models: modelsMap } : {}),
  };
  appendRegistryEvent(startEvent);

  // Build claude command
  const claudePrompt = `Read the deployment primer at '${primerFile}' using the Read tool and follow ALL instructions in it exactly. Start immediately. When finished, write the completion marker and exit.`;

  if (mode === "direct") {
    console.log(`Deploying team (direct): ${teamConfig.name} [${deployId}]`);
    execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
      stdio: "inherit",
      env: deployEnv,
    });
  } else if (mode === "interactive") {
    console.log(`Deploying team (interactive): ${teamConfig.name} [${deployId}]`);
    console.log("  You will be prompted to approve tool calls.");
    execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
      stdio: "inherit",
      env: deployEnv,
    });
  } else if (mode === "foreground") {
    console.log(`Deploying team (foreground): ${teamConfig.name} [${deployId}]`);
    execSync(`claude ${modelFlag} --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`.trim(), {
      stdio: "inherit",
      env: deployEnv,
    });
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

    // Build background script
    const bgScript = `
export PA_DEPLOYMENT_ID='${deployId}'
export PA_DEPLOYMENT_DIR='${deployDir}'
export PA_ACTIVITY_LOG='${activityLog}'
echo '[$(date -Iseconds)] claude starting...' >> '${logFile}'
stdbuf -oL timeout '${maxRuntime}' claude ${modelFlag ? modelFlag + " " : ""}--dangerously-skip-permissions --print '${claudePrompt.replace(/'/g, "'\\''")}' >> '${logFile}' 2>'${logFile}.err'
exit_code=$?
echo '' >> '${logFile}'
echo "[$(date -Iseconds)] claude exited with code $exit_code" >> '${logFile}'
if [[ -s '${logFile}.err' ]]; then
  echo '' >> '${logFile}'
  echo '=== STDERR ===' >> '${logFile}'
  cat '${logFile}.err' >> '${logFile}'
fi
rm -f '${logFile}.err'
if [[ $exit_code -eq 124 ]]; then
  echo '[$(date -Iseconds)] TIMED OUT after ${maxRuntime}s' >> '${logFile}'
  crash_ts=$(date -Iseconds)
  crash_json='{"deployment_id":"${deployId}","team":"${teamName}","event":"crashed","timestamp":"'"$crash_ts"'","exit_code":124,"summary":"Timed out after ${maxRuntime}s"}'
  { flock -w 5 9; printf '%s\n' "$crash_json" >> '${registryFile}'; } 9>'${registryLock}'
elif [[ $exit_code -ne 0 ]]; then
  crash_ts=$(date -Iseconds)
  crash_json='{"deployment_id":"${deployId}","team":"${teamName}","event":"crashed","timestamp":"'"$crash_ts"'","exit_code":'"$exit_code"'}'
  { flock -w 5 9; printf '%s\n' "$crash_json" >> '${registryFile}'; } 9>'${registryLock}'
fi
`.trim();

    // Spawn background process via nohup
    const bgPid = spawnDetached("nohup", [bashPath, "-c", bgScript], {
      cwd: process.cwd(),
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
