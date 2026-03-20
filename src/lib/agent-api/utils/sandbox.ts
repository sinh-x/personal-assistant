import { resolve } from "node:path";
import { homedir } from "node:os";

const SANDBOX_ROOT = resolve(homedir(), "Documents/ai-usage");

/**
 * Validate that a given path is inside the ~/Documents/ai-usage/ sandbox.
 * Returns the resolved absolute path if valid, or throws if outside sandbox.
 */
export function validateSandboxPath(inputPath: string): string {
  const resolved = resolve(inputPath);
  if (!resolved.startsWith(SANDBOX_ROOT + "/") && resolved !== SANDBOX_ROOT) {
    throw new Error(`Path traversal denied: "${inputPath}" is outside sandbox root`);
  }
  return resolved;
}

/**
 * Check if a path is inside the sandbox without throwing.
 */
export function isInsideSandbox(inputPath: string): boolean {
  try {
    validateSandboxPath(inputPath);
    return true;
  } catch {
    return false;
  }
}
