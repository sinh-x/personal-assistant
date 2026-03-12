import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getHomeDir, getDataDir, getRegistryPath, getRegistryLockPath } from "../lib/paths.js";
import { parseTeamYaml } from "../lib/yaml-parser.js";
import { appendRegistryEvent } from "../lib/registry.js";
import { generatePrimer } from "../lib/primer.js";
import { spawnDetached } from "../utils/process.js";
import type { RegistryEvent } from "../lib/types.js";

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
    foreground?: boolean;
    interactive?: boolean;
    objective?: string;
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

  // Determine mode
  let mode: "background" | "dry-run" | "foreground" | "interactive" = "background";
  if (opts.dryRun) mode = "dry-run";
  else if (opts.foreground) mode = "foreground";
  else if (opts.interactive) mode = "interactive";

  // Resolve team file: file path or name
  let teamFile: string;
  let teamName: string;

  if (existsSync(spec)) {
    // Absolute path to a YAML file
    teamFile = resolve(dirname(spec), basename(spec));
    teamName = basename(spec, ".yaml");
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
  mkdirSync(resolve(deploymentsDir, deployId), { recursive: true });

  // Parse team YAML
  const teamConfig = parseTeamYaml(teamFile);
  const agentNames = teamConfig.agents.map((a) => a.name);

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
    resolveFile,
    configDir: config.configDir,
    homeDir: paHome,
  });
  writeFileSync(primerFile, primerContent);
  console.log(`Primer generated: ${primerFile}`);

  // Dry run — print primer and exit
  if (mode === "dry-run") {
    console.log("--- DRY RUN — primer content: ---");
    process.stdout.write(readFileSync(primerFile, "utf-8"));
    return;
  }

  // Write start event to registry
  const startEvent: RegistryEvent = {
    deployment_id: deployId,
    team: teamName,
    event: "started",
    timestamp: deployTs,
    agents: agentNames,
    primer: primerFile,
  };
  appendRegistryEvent(startEvent);

  // Build claude command
  const claudePrompt = `Read the deployment primer at '${primerFile}' using the Read tool and follow ALL instructions in it exactly. Start immediately. When finished, write the completion marker and exit.`;

  if (mode === "interactive") {
    console.log(`Deploying team (interactive): ${teamConfig.name} [${deployId}]`);
    console.log("  You will be prompted to approve tool calls.");
    execSync(`claude ${JSON.stringify(claudePrompt)}`, {
      stdio: "inherit",
    });
  } else if (mode === "foreground") {
    console.log(`Deploying team (foreground): ${teamConfig.name} [${deployId}]`);
    execSync(`claude --dangerously-skip-permissions ${JSON.stringify(claudePrompt)}`, {
      stdio: "inherit",
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
echo '[$(date -Iseconds)] claude starting...' >> '${logFile}'
stdbuf -oL timeout '${maxRuntime}' claude --dangerously-skip-permissions --print '${claudePrompt.replace(/'/g, "'\\''")}' >> '${logFile}' 2>'${logFile}.err'
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
  flock -w 5 '${registryLock}' bash -c "echo '{\"deployment_id\":\"${deployId}\",\"team\":\"${teamName}\",\"event\":\"crashed\",\"timestamp\":\"'$(date -Iseconds)'\",\"exit_code\":124,\"summary\":\"Timed out after ${maxRuntime}s\"}' >> '${registryFile}'"
elif [[ $exit_code -ne 0 ]]; then
  flock -w 5 '${registryLock}' bash -c "echo '{\"deployment_id\":\"${deployId}\",\"team\":\"${teamName}\",\"event\":\"crashed\",\"timestamp\":\"'$(date -Iseconds)'\",\"exit_code\":'$exit_code'}' >> '${registryFile}'"
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
