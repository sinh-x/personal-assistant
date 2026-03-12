import { execSync } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Remove a scheduled team deployment timer.
 * Replaces remove-timer.sh (17 lines).
 */
export function removeTimerCommand(teamName: string): void {
  const unitName = `pa-${teamName}`;
  const systemdDir = resolve(
    process.env["XDG_CONFIG_HOME"] ?? resolve(homedir(), ".config"),
    "systemd/user"
  );

  // Stop timer (ignore errors if not running)
  try {
    execSync(`systemctl --user stop ${unitName}.timer`, { stdio: "ignore" });
  } catch {
    // timer may not be active
  }

  // Disable timer (ignore errors if not enabled)
  try {
    execSync(`systemctl --user disable ${unitName}.timer`, { stdio: "ignore" });
  } catch {
    // timer may not be enabled
  }

  // Remove unit files
  const timerFile = resolve(systemdDir, `${unitName}.timer`);
  const serviceFile = resolve(systemdDir, `${unitName}.service`);
  if (existsSync(timerFile)) unlinkSync(timerFile);
  if (existsSync(serviceFile)) unlinkSync(serviceFile);

  // Reload systemd daemon
  execSync("systemctl --user daemon-reload", { stdio: "ignore" });

  console.log(`Removed timer: ${unitName}`);
}
