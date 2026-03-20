/**
 * Folder browsing routes.
 *
 * Source path patterns vary by depth:
 *   GET /api/folders/inbox[/:file]                     — inbox (no subfolder)
 *   GET /api/folders/for-later[/:file]                 — for-later (no subfolder)
 *   GET /api/folders/sinh-inputs/:folder[/:file]       — sinh-inputs with subfolder
 *   GET /api/folders/teams/:teamName/:folder[/:file]   — teams with team + subfolder
 *
 * Sources:
 *   inbox       → ~/Documents/ai-usage/sinh-inputs/inbox/
 *   for-later   → ~/Documents/ai-usage/sinh-inputs/for-later/
 *   sinh-inputs → ~/Documents/ai-usage/sinh-inputs/<folder>/
 *                 allowed subfolders: approved, rejected, deferred, done, ideas, for-later
 *   teams/:name → ~/Documents/ai-usage/agent-teams/:name/<folder>/
 *
 * All paths are validated to stay inside ~/Documents/ai-usage/.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  parseMarkdownMetadata,
  detectDocumentType,
} from "../utils/markdown.js";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");

const SINH_INPUTS_SUBFOLDERS = new Set([
  "approved",
  "rejected",
  "deferred",
  "done",
  "ideas",
  "for-later",
]);

function isInsideSandbox(p: string): boolean {
  const resolved = resolve(p);
  return (
    resolved.startsWith(AI_USAGE + "/") || resolved === AI_USAGE
  );
}

function isSafeSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\"))
    return false;
  if (segment.startsWith(".")) return false;
  return true;
}

/** Resolve source + folder (and optional team name) to an absolute directory path. */
function resolveSourcePath(
  source: string,
  folder: string,
  teamName?: string
): string | null {
  switch (source) {
    case "inbox":
      // folder is ignored for inbox — the inbox IS the folder
      return join(AI_USAGE, "sinh-inputs", "inbox");

    case "sinh-inputs":
      if (!SINH_INPUTS_SUBFOLDERS.has(folder)) return null;
      return join(AI_USAGE, "sinh-inputs", folder);

    case "for-later":
      return join(AI_USAGE, "sinh-inputs", "for-later");

    case "teams":
      if (!teamName || !isSafeSegment(teamName)) return null;
      if (!isSafeSegment(folder)) return null;
      return join(AI_USAGE, "agent-teams", teamName, folder);

    default:
      return null;
  }
}

interface FolderItem {
  id: string;
  title: string;
  date?: string;
  type?: string;
  size: number;
  modified: string;
}

async function listFolder(dirPath: string): Promise<FolderItem[]> {
  if (!existsSync(dirPath)) return [];
  const entries = await readdir(dirPath);
  const items: FolderItem[] = [];
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

export function foldersRoutes(): Hono {
  const app = new Hono();

  // Path depth varies by source type:
  //   /api/folders/inbox[/:file]                    (1-2 segments)
  //   /api/folders/for-later[/:file]                (1-2 segments)
  //   /api/folders/sinh-inputs/:folder[/:file]      (2-3 segments)
  //   /api/folders/teams/:teamName/:folder[/:file]  (3-4 segments)
  app.get("/api/folders/*", async (c: Context) => {
    const rawPath = c.req.path;
    const prefix = "/api/folders/";
    if (!rawPath.startsWith(prefix)) {
      return c.json({ error: "Invalid path" }, 400);
    }

    const rest = rawPath.substring(prefix.length);
    const segments = rest
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s));

    if (segments.length < 1) {
      return c.json(
        { error: "source is required", code: "BAD_REQUEST" },
        400
      );
    }

    const source = segments[0];
    let folder: string;
    let teamName: string | undefined;
    let filename: string | undefined;

    if (source === "teams") {
      // /api/folders/teams/:teamName/:folder[/:filename]
      if (segments.length < 3) {
        return c.json(
          { error: "team name and folder required", code: "BAD_REQUEST" },
          400
        );
      }
      teamName = segments[1];
      folder = segments[2];
      filename = segments.length >= 4 ? segments[3] : undefined;
    } else if (source === "inbox" || source === "for-later") {
      // /api/folders/inbox[/:filename]
      // /api/folders/for-later[/:filename]
      // These sources have no subfolder — next segment (if any) is the filename
      folder = source; // placeholder — resolveSourcePath ignores it for these
      filename = segments.length >= 2 ? segments[1] : undefined;
    } else if (source === "sinh-inputs") {
      // /api/folders/sinh-inputs/:folder[/:filename]
      if (segments.length < 2) {
        return c.json(
          { error: "folder is required for sinh-inputs", code: "BAD_REQUEST" },
          400
        );
      }
      folder = segments[1];
      filename = segments.length >= 3 ? segments[2] : undefined;
    } else {
      return c.json(
        { error: "Unknown source", code: "NOT_FOUND" },
        404
      );
    }

    // Validate segments
    if (!isSafeSegment(source) || !isSafeSegment(folder)) {
      return c.json({ error: "Invalid path", code: "SANDBOX_VIOLATION" }, 403);
    }

    const dirPath = resolveSourcePath(source, folder, teamName);
    if (!dirPath) {
      return c.json({ error: "Unknown source or folder", code: "NOT_FOUND" }, 404);
    }

    if (!isInsideSandbox(dirPath)) {
      return c.json({ error: "Path traversal denied", code: "SANDBOX_VIOLATION" }, 403);
    }

    // Read single file
    if (filename) {
      if (!isSafeSegment(filename)) {
        return c.json({ error: "Invalid filename", code: "SANDBOX_VIOLATION" }, 403);
      }
      const filePath = join(dirPath, filename);
      if (!isInsideSandbox(filePath) || !existsSync(filePath)) {
        return c.json({ error: "File not found", code: "NOT_FOUND" }, 404);
      }
      const content = await readFile(filePath, "utf8");
      const metadata = parseMarkdownMetadata(content, filename);
      const docType = detectDocumentType(content, filename);
      return c.json({
        id: filename,
        source,
        folder,
        ...metadata,
        type: docType,
        content,
      });
    }

    // List folder
    if (!existsSync(dirPath)) {
      return c.json({
        source,
        folder,
        items: [],
        total: 0,
        hasMore: false,
      });
    }

    const items = await listFolder(dirPath);
    return c.json({
      source,
      folder,
      items,
      total: items.length,
      hasMore: false,
    });
  });

  return app;
}
