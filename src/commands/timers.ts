import { execSync } from "node:child_process";

/**
 * List all personal-assistant scheduled timers.
 * Replaces list-timers.sh (3 lines).
 */
export function timersCommand(): void {
  try {
    const output = execSync("systemctl --user list-timers 'pa-*' --no-pager", {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    process.stdout.write(output);
  } catch (err) {
    // systemctl exits non-zero if no timers found — still show output
    const execErr = err as { stdout?: string; status?: number };
    if (execErr.stdout) {
      process.stdout.write(execErr.stdout);
    }
  }
}
