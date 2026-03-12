import { execSync, type SpawnOptions, spawn } from "node:child_process";

/**
 * Check if a process with the given PID is alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command synchronously and return stdout.
 * Throws on non-zero exit code.
 */
export function runSync(command: string): string {
  return execSync(command, { encoding: "utf-8" }).trim();
}

/**
 * Spawn a detached background process.
 * Returns the child PID.
 */
export function spawnDetached(
  command: string,
  args: string[],
  options: Partial<SpawnOptions> = {}
): number {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    ...options,
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn: ${command} ${args.join(" ")}`);
  }
  return child.pid;
}
