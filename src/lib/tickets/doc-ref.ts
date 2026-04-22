/**
 * Doc-ref helpers (Phase 4.1, PA-1210)
 */

import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { normalizeSandboxPath } from "../agent-api/utils/sandbox.js";
import { DOC_REF_TYPE_DISPLAY } from "./types.js";

/**
 * Normalize a raw doc-ref type string to its canonical short form.
 *
 * - Long-form aliases (`requirements`, `implementation`) → short codes (`req`, `impl`)
 * - Unknown types pass through unchanged (allows custom types)
 */
export function normalizeDocRefType(raw: string): string {
  const lower = raw.toLowerCase();
  switch (lower) {
    case "requirements":
      return "req";
    case "implementation":
      return "impl";
    default:
      return lower;
  }
}

/**
 * Format a doc-ref as a display badge, e.g. "[★REQ]" or "[UAT]".
 * Uses `DOC_REF_TYPE_DISPLAY` for known types; falls back to uppercase raw type.
 */
export function formatDocRefBadge(docRef: { type: string; primary?: boolean }): string {
  const display = DOC_REF_TYPE_DISPLAY[docRef.type] ?? docRef.type.toUpperCase();
  const star = docRef.primary ? "★" : "";
  return `[${star}${display}]`;
}

/**
 * Derive a human-readable title from a doc-ref.
 *
 * Fallback chain:
 * 1. H1 from markdown file (first line starting with `# `, not inside fenced code)
 * 2. frontmatter `title:` field (if `.md` file, YAML frontmatter present)
 * 3. Filename with `YYYY-MM-DD-` prefix and `.md` suffix stripped
 * 4. Raw `path` value
 *
 * NF2: reads at most first 16 KiB of any markdown file to bound I/O.
 */
export function deriveDocRefTitle(docRef: { type: string; path: string }): string {
  const MAX_BYTES = 16 * 1024; // 16 KiB

  // Only try markdown path for H1/frontmatter lookup
  if (extname(docRef.path).toLowerCase() === ".md") {
    const resolved = normalizeSandboxPath(docRef.path);

    let content: string | undefined;
    try {
      content = readFileSync(resolved, { encoding: "utf8" });
      if (content.length > MAX_BYTES) {
        content = content.slice(0, MAX_BYTES);
      }
    } catch {
      // File read failed — fall through to filename strip
    }

    if (content !== undefined) {
      // H1: line starting with "# " at column 0, outside fenced code blocks
      // Simple state machine: track whether we're inside a fenced code block
      let inCodeBlock = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("```")) {
          // Toggle code block state
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && trimmed.startsWith("# ")) {
          // H1 found outside code block — strip the "# " prefix and return
          return trimmed.slice(2).trim();
        }
        // Also check for YAML frontmatter `title:` field (--- ... --- block)
        if (!inCodeBlock && line.startsWith("title:") && !line.startsWith("#")) {
          const val = line.slice("title:".length).trim();
          if (val) return val;
        }
      }
    }
  }

  // Filename fallback: only strip YYYY-MM-DD prefix and .md suffix for .md files
  if (extname(docRef.path).toLowerCase() === ".md") {
    const stripped = basename(docRef.path).replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/i, "");
    return stripped || docRef.path;
  }
  return docRef.path;
}