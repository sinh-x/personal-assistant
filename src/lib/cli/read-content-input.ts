import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve content that may be passed either as an inline string or from a file.
 *
 * Multi-line content with embedded `"`, backticks, or `$(...)` is easy to
 * silently mutilate through shell quoting (bash terminates the outer `"..."`
 * at the first unescaped `"` and parses the rest as commands). The file-input
 * form bypasses shell quoting entirely.
 *
 * Returns `undefined` when neither input is set — callers decide whether
 * absence is an error.
 */
export function resolveContentInput(
  inline: string | undefined,
  file: string | undefined,
  label: string
): string | undefined {
  if (inline !== undefined && file !== undefined) {
    console.error(
      `Error: --${label} and --${label}-file are mutually exclusive; pass exactly one.`
    );
    process.exit(1);
  }
  if (file !== undefined) {
    const path = resolve(process.cwd(), file);
    try {
      return readFileSync(path, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: failed to read --${label}-file ${path}: ${msg}`);
      process.exit(1);
    }
  }
  return inline;
}
