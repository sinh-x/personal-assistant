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
 *
 * GET /api/images?path=<path>
 *
 * Serves image files (png, jpg, gif, svg, webp) from ~/Documents/ai-usage/
 * with proper Content-Type headers. Reuses sandbox security for path validation.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { validateSandboxPath, normalizeSandboxPath } from "../utils/sandbox.js";
import {
  parseMarkdownMetadata,
  detectDocumentType,
} from "../utils/markdown.js";

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]);

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

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

    const normalized = normalizeSandboxPath(pathParam);

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

  app.get("/api/images", async (c: Context) => {
    const imgPathParam = c.req.query("path");
    if (!imgPathParam) {
      return c.json(
        { error: "path query param is required", code: "BAD_REQUEST" },
        400
      );
    }

    const normalized = normalizeSandboxPath(imgPathParam);

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

    const ext = extname(resolvedPath).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return c.json(
        { error: "Unsupported image format", code: "UNSUPPORTED_MEDIA_TYPE" },
        415
      );
    }

    const contentType = IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream";
    const statImg = statSync(resolvedPath);
    const fileBuffer = await readFile(resolvedPath);

    c.header("Content-Type", contentType);
    c.header("Content-Length", String(statImg.size));
    return c.body(fileBuffer);
  });

  return app;
}
