import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getHomeDir } from "../lib/paths.js";

/**
 * Schedule a team deployment using systemd user timers.
 * Replaces schedule.sh (159 lines).
 */
export function scheduleCommand(
  spec: string,
  repeat: string,
  times: string[]
): void {
  const config = loadConfig();
  const paHome = getHomeDir();
  const paBin = process.env["PA_BIN"] ?? "";

  // Default time if none given
  if (times.length === 0) {
    times = ["09:00"];
  }

  // Resolve bash path at schedule-time (NixOS doesn't have /bin/bash)
  let bashPath: string;
  try {
    bashPath = execSync("command -v bash", { encoding: "utf-8" }).trim();
  } catch {
    bashPath = "/usr/bin/env bash";
  }

  // Determine exec command and unit name
  let execCmd: string;
  let unitName: string;
  let description: string;

  if (spec.startsWith("daily:")) {
    const dailyMode = spec.slice(6);
    if (!["plan", "progress", "end"].includes(dailyMode)) {
      console.error(
        `Error: Invalid daily mode '${dailyMode}'. Use: plan | progress | end`
      );
      process.exit(1);
    }
    if (paBin) {
      execCmd = `${paBin}/pa-daily ${dailyMode}`;
    } else {
      // Use script directly (dev mode)
      const scriptDir = resolve(paHome);
      execCmd = `${bashPath} "${scriptDir}/daily.sh" "${dailyMode}"`;
    }
    unitName = `pa-daily-${dailyMode}`;
    description = `personal-assistant daily ${dailyMode}`;
  } else {
    const teamName = spec;
    // Verify team exists
    let teamFile = "";
    if (config.configDir && existsSync(resolve(config.configDir, "teams", `${teamName}.yaml`))) {
      teamFile = resolve(config.configDir, "teams", `${teamName}.yaml`);
    } else if (existsSync(resolve(paHome, "teams", `${teamName}.yaml`))) {
      teamFile = resolve(paHome, "teams", `${teamName}.yaml`);
    }
    if (!teamFile) {
      console.error(`Error: Team not found: ${teamName}`);
      process.exit(1);
    }
    if (paBin) {
      execCmd = `${paBin}/pa-deploy ${teamName}`;
    } else {
      const scriptDir = resolve(paHome);
      execCmd = `${bashPath} "${scriptDir}/deploy.sh" "${teamName}"`;
    }
    unitName = `pa-${teamName}`;
    description = `personal-assistant deploy: ${teamName}`;
  }

  // Build OnCalendar lines
  let onCalendarLines = "";
  let timeDisplay = "";

  for (const t of times) {
    const [hour, min] = t.split(":");
    let cal: string;
    switch (repeat) {
      case "hourly":
        cal = "hourly";
        break;
      case "daily":
        cal = `*-*-* ${hour}:${min}:00`;
        break;
      case "weekly":
        cal = `Mon *-*-* ${hour}:${min}:00`;
        break;
      case "monthly":
        cal = `*-*-01 ${hour}:${min}:00`;
        break;
      default:
        console.error(`Error: Invalid repeat: ${repeat}`);
        process.exit(1);
    }
    onCalendarLines += `OnCalendar=${cal}\n`;
    timeDisplay += ` ${t}`;
  }

  // Systemd user directory
  const systemdDir = resolve(
    process.env["XDG_CONFIG_HOME"] ?? resolve(homedir(), ".config"),
    "systemd/user"
  );
  mkdirSync(systemdDir, { recursive: true });

  // Build environment lines
  let envLines = `Environment=HOME=${homedir()}`;
  const scriptDir = resolve(paHome);
  if (paHome && paHome !== scriptDir) {
    envLines += `\nEnvironment=PA_HOME=${paHome}`;
  }
  const paData = process.env["PA_DATA"] ?? "";
  if (paData && paData !== paHome) {
    envLines += `\nEnvironment=PA_DATA=${paData}`;
  }
  if (paBin) {
    envLines += `\nEnvironment=PA_BIN=${paBin}`;
  }

  // Write service unit
  const serviceContent = `[Unit]
Description=${description}

[Service]
Type=oneshot
ExecStart=${execCmd}
KillMode=process
${envLines}
`;
  writeFileSync(resolve(systemdDir, `${unitName}.service`), serviceContent);

  // Write timer unit
  const timerContent = `[Unit]
Description=${description} (${repeat} at${timeDisplay})

[Timer]
${onCalendarLines}Persistent=true

[Install]
WantedBy=timers.target
`;
  writeFileSync(resolve(systemdDir, `${unitName}.timer`), timerContent);

  // Enable
  execSync("systemctl --user daemon-reload", { stdio: "ignore" });
  execSync(`systemctl --user enable --now "${unitName}.timer"`, {
    stdio: "ignore",
  });

  console.log(`Scheduled: ${unitName} (${repeat} at${timeDisplay})`);
  console.log(`Timer: ${unitName}.timer`);
  console.log("");
  console.log("Manage with:");
  console.log(`  systemctl --user status ${unitName}.timer`);
  console.log(`  systemctl --user list-timers '${unitName}*'`);
  console.log(`  pa remove-timer ${unitName.replace(/^pa-/, "")}`);
}
