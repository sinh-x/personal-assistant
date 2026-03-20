/**
 * Inbox routes — list inbox items and perform actions.
 *
 * GET  /api/inbox              — list items with parsed frontmatter
 * POST /api/inbox/:id/action   — approve | reject | defer | acknowledge |
 *                               save-for-later | append-section
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  parseMarkdownMetadata,
  detectDocumentType,
  writeFeedbackAnnotation,
} from "../utils/markdown.js";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const INBOX = join(AI_USAGE, "sinh-inputs", "inbox");
const APPROVED = join(AI_USAGE, "sinh-inputs", "approved");
const REJECTED = join(AI_USAGE, "sinh-inputs", "rejected");
const DEFERRED = join(AI_USAGE, "sinh-inputs", "deferred");
const FOR_LATER = join(AI_USAGE, "sinh-inputs", "for-later");
const DONE = join(AI_USAGE, "sinh-inputs", "done");

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

function isSafeFilename(name: string): boolean {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\"))
    return false;
  if (name.startsWith(".")) return false;
  return true;
}

async function listMarkdownItems(
  dir: string
): Promise<Record<string, unknown>[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const items: Record<string, unknown>[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".md")) continue;
    try {
      const filePath = join(dir, filename);
      const content = await readFile(filePath, "utf8");
      const metadata = parseMarkdownMetadata(content, filename);
      const docType = detectDocumentType(content, filename);
      const stat = statSync(filePath);
      items.push({
        id: filename,
        ...metadata,
        type: docType,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // skip malformed files
    }
  }
  items.sort((a, b) => {
    const aDate = (a["date"] as string) ?? "";
    const bDate = (b["date"] as string) ?? "";
    return bDate.localeCompare(aDate);
  });
  return items;
}

export function inboxRoutes(): Hono {
  const app = new Hono();

  // GET /api/inbox — list inbox items
  app.get("/api/inbox", async (c: Context) => {
    const items = await listMarkdownItems(INBOX);
    const countByType: Record<string, number> = {};
    for (const item of items) {
      const t = (item["type"] as string) ?? "work-report";
      countByType[t] = (countByType[t] ?? 0) + 1;
    }
    return c.json({ items, count_by_type: countByType });
  });

  // POST /api/inbox/:id/action — consolidated action endpoint
  app.post("/api/inbox/:id/action", async (c: Context) => {
    const id = c.req.param("id");
    if (!id || !isSafeFilename(id)) {
      return c.json({ error: "Invalid filename", code: "INVALID_PATH" }, 403);
    }

    const srcPath = join(INBOX, id);
    if (!existsSync(srcPath)) {
      return c.json({ error: "File not found", code: "NOT_FOUND" }, 404);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // body is optional for some actions
    }

    const action = body["action"] as string | undefined;
    if (!action) {
      return c.json({ error: "action is required", code: "BAD_REQUEST" }, 400);
    }

    const content = await readFile(srcPath, "utf8");

    switch (action) {
      case "approve": {
        const note = body["note"] as string | undefined;
        const chips = Array.isArray(body["chips"])
          ? (body["chips"] as string[])
          : [];
        const annotated = writeFeedbackAnnotation(content, {
          kind: "approve",
          note,
          chips,
        });
        if (annotated !== content) await writeFile(srcPath, annotated, "utf8");
        await ensureDir(APPROVED);
        await rename(srcPath, join(APPROVED, id));
        return c.json({ status: "approved", file: id });
      }

      case "reject": {
        const pending = body["pending"] === true;
        if (pending) {
          const updated = writeFeedbackAnnotation(content, {
            kind: "pending-reject",
          });
          await writeFile(srcPath, updated, "utf8");
          return c.json({ status: "pending-reject-feedback", file: id });
        }
        const what_is_wrong = body["what_is_wrong"] as string | undefined;
        const what_to_fix = body["what_to_fix"] as string | undefined;
        if (!what_is_wrong || !what_to_fix) {
          return c.json(
            {
              error: "what_is_wrong and what_to_fix are required",
              code: "BAD_REQUEST",
            },
            400
          );
        }
        const priority = (body["priority"] as string) ?? "medium";
        const chips = Array.isArray(body["chips"])
          ? (body["chips"] as string[])
          : [];
        const annotated = writeFeedbackAnnotation(content, {
          kind: "reject",
          what_is_wrong,
          what_to_fix,
          priority,
          chips,
        });
        await writeFile(srcPath, annotated, "utf8");
        await ensureDir(REJECTED);
        await rename(srcPath, join(REJECTED, id));
        return c.json({ status: "rejected", file: id });
      }

      case "defer": {
        const reason = body["reason"] as string | undefined;
        const requeue_after = body["requeue_after"] as string | undefined;
        const chips = Array.isArray(body["chips"])
          ? (body["chips"] as string[])
          : [];
        const updated = writeFeedbackAnnotation(content, {
          kind: "defer",
          reason,
          requeue_after,
          chips,
        });
        if (updated !== content) await writeFile(srcPath, updated, "utf8");
        await ensureDir(DEFERRED);
        await rename(srcPath, join(DEFERRED, id));
        return c.json({ status: "deferred", file: id });
      }

      case "acknowledge": {
        const note = body["note"] as string | undefined;
        const updated = writeFeedbackAnnotation(content, {
          kind: "acknowledge",
          note,
        });
        if (updated !== content) await writeFile(srcPath, updated, "utf8");
        await ensureDir(DONE);
        await rename(srcPath, join(DONE, id));
        return c.json({ status: "acknowledged", file: id });
      }

      case "save-for-later": {
        const updated = writeFeedbackAnnotation(content, {
          kind: "save-for-later",
        });
        await writeFile(srcPath, updated, "utf8");
        await ensureDir(FOR_LATER);
        await rename(srcPath, join(FOR_LATER, id));
        return c.json({ status: "saved-for-later", file: id });
      }

      case "append-section": {
        const title = body["title"] as string | undefined;
        const sectionContent = (body["content"] as string) ?? "";
        if (!title || title.length === 0) {
          return c.json(
            { error: "title is required", code: "BAD_REQUEST" },
            400
          );
        }
        let result = content;
        if (!result.endsWith("\n")) result = result + "\n";
        if (!result.endsWith("\n\n")) result = result + "\n";
        result = result + `### ${title}\n\n${sectionContent}\n`;
        await writeFile(srcPath, result, "utf8");
        return c.json({ status: "section-appended", file: id, title });
      }

      default:
        return c.json(
          { error: `Unknown action: ${action}`, code: "BAD_REQUEST" },
          400
        );
    }
  });

  return app;
}
