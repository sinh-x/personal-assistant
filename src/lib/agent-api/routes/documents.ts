/**
 * Document reading route.
 *
 * GET /api/documents?path=<path>
 *
 * Resolves the path relative to ~/Documents/ai-usage/:
 *   - Relative paths (e.g. agent-teams/requirements/artifacts/file.md) → joined to sandbox root
 *   - Paths with ~/Documents/ai-usage/ prefix → expanded to absolute
 *   - Absolute paths already inside sandbox → used as-is
 *
 * If path is a directory → returns a listing of .md files.
 * If path is a file → returns { path, content, metadata }.
 *
 * Uses validateSandboxPath() as defense-in-depth (global middleware already
 * validates ?path= params for absolute paths).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { validateSandboxPath } from "../utils/sandbox.js";
import {
  parseMarkdownMetadata,
  detectDocumentType,
} from "../utils/markdown.js";

const HOME = homedir();
const AI_USAGE = join(HOME, "Documents", "ai-usage");
const AI_USAGE_TILDE = "~/Documents/ai-usage/";

/** Normalize a doc_ref / path param to an absolute filesystem path. */
function normalizePath(inputPath: string): string {
  // Strip ~/Documents/ai-usage/ prefix (literal ~ not expanded by resolve)
  if (inputPath.startsWith(AI_USAGE_TILDE)) {
    return join(AI_USAGE, inputPath.slice(AI_USAGE_TILDE.length));
  }
  // Handle other ~/... paths
  if (inputPath.startsWith("~/")) {
    return join(HOME, inputPath.slice(2));
  }
  // Already absolute
  if (inputPath.startsWith("/")) {
    return inputPath;
  }
  // Relative — resolve against sandbox root
  return join(AI_USAGE, inputPath);
}

interface FileItem {
  id: string;
  title: string;
  date?: string;
  type?: string;
  size: number;
  modified: string;
}

async function listDir(dirPath: string): Promise<FileItem[]> {
  const entries = await readdir(dirPath);
  const items: FileItem[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".md")) continue;
    const filePath = join(dirPath, filename);
    try {
      const content = await readFile(filePath, "utf8");
      const metadata = parseMarkdownMetadata(content, filename);
      const docType = detectDocumentType(content, filename);
      const stat = statSync(filePath);
      items.push({
        id: filename,
        title: metadata.title,
        date: metadata.date,
        type: docType,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable files
    }
  }
  items.sort((a, b) => {
    const aDate = a.date ?? "";
    const bDate = b.date ?? "";
    return bDate.localeCompare(aDate);
  });
  return items;
}

export function documentsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/documents", async (c: Context) => {
    const pathParam = c.req.query("path");
    if (!pathParam) {
      return c.json(
        { error: "path query param is required", code: "BAD_REQUEST" },
        400
      );
    }

    const normalized = normalizePath(pathParam);

    // Defense-in-depth: validate resolved path is inside sandbox
    let resolvedPath: string;
    try {
      resolvedPath = validateSandboxPath(normalized);
    } catch {
      return c.json(
        { error: "Path traversal denied", code: "SANDBOX_VIOLATION" },
        403
      );
    }

    if (!existsSync(resolvedPath)) {
      return c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
    }

    const stat = statSync(resolvedPath);

    // Directory listing
    if (stat.isDirectory()) {
      const items = await listDir(resolvedPath);
      return c.json({ path: pathParam, items, total: items.length });
    }

    // File reading
    const content = await readFile(resolvedPath, "utf8");
    const filename = basename(resolvedPath);
    const metadata = parseMarkdownMetadata(content, filename);
    const docType = detectDocumentType(content, filename);

    return c.json({
      path: pathParam,
      content,
      metadata: {
        ...metadata,
        type: docType,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      },
    });
  });

  return app;
}
