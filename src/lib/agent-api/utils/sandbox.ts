import { resolve, join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SANDBOX_ROOT = resolve(HOME, "Documents/ai-usage");
const TILDE_PREFIX = "~/Documents/ai-usage/";

/**
 * Normalize a path (relative, tilde-prefixed, or absolute) to an absolute path
 * within the sandbox. Used by middleware and route handlers.
 */
export function normalizeSandboxPath(inputPath: string): string {
  if (inputPath.startsWith(TILDE_PREFIX)) {
    return join(SANDBOX_ROOT, inputPath.slice(TILDE_PREFIX.length));
  }
  if (inputPath.startsWith("~/")) {
    return join(HOME, inputPath.slice(2));
  }
  if (inputPath.startsWith("/")) {
    return inputPath;
  }
  // Relative — resolve against sandbox root
  return join(SANDBOX_ROOT, inputPath);
}

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
