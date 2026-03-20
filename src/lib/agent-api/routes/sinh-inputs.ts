/**
 * Sinh-inputs action routes — file actions on non-inbox sinh-inputs folders.
 *
 * POST /api/sinh-inputs/:folder/:filename/action
 *   Body: {action: 'requeue'|'archive'|'save-for-later'|'append-section', ...params}
 *
 * Actions:
 *   requeue       — move back to inbox/, add requeued_from frontmatter
 *   archive       — move to done/
 *   save-for-later — move to for-later/ (only for approved folder)
 *   append-section — append ### section to file (stays in place)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const SINH_INPUTS = join(AI_USAGE, "sinh-inputs");

const ALLOWED_FOLDERS = new Set(["approved", "rejected", "deferred", "done", "ideas"]);

function isSafeFilename(name: string): boolean {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\"))
    return false;
  if (name.startsWith(".")) return false;
  return true;
}

function isInsideSandbox(p: string): boolean {
  const r = resolve(p);
  return r.startsWith(AI_USAGE + "/") || r === AI_USAGE;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Insert or update a top-level key in YAML frontmatter.
 * Creates a frontmatter block if none exists.
 */
function insertFrontmatterKey(content: string, key: string, value: string): string {
  if (content.startsWith("---\n")) {
    const endIdx = content.indexOf("\n---\n", 4);
    if (endIdx !== -1) {
      let fm = content.substring(4, endIdx);
      const after = content.substring(endIdx + 5);
      // Remove existing key if present
      fm = fm
        .split("\n")
        .filter((line) => !line.startsWith(`${key}:`))
        .join("\n");
      if (fm.length > 0 && !fm.endsWith("\n")) fm = fm + "\n";
      fm = fm + `${key}: ${value}`;
      return `---\n${fm}\n---\n${after}`;
    }
  }
  return `---\n${key}: ${value}\n---\n${content}`;
}

export function sinhInputsRoutes(): Hono {
  const app = new Hono();

  // POST /api/sinh-inputs/:folder/:filename/action
  app.post("/api/sinh-inputs/:folder/:filename/action", async (c: Context) => {
    const folder = c.req.param("folder") ?? "";
    const filename = c.req.param("filename") ?? "";

    if (!ALLOWED_FOLDERS.has(folder)) {
      return c.json({ error: "Unknown folder", code: "NOT_FOUND" }, 404);
    }
    if (!isSafeFilename(filename)) {
      return c.json({ error: "Invalid filename", code: "INVALID_PATH" }, 403);
    }

    const srcPath = join(SINH_INPUTS, folder, filename);
    if (!isInsideSandbox(srcPath)) {
      return c.json({ error: "Path traversal denied", code: "SANDBOX_VIOLATION" }, 403);
    }
    if (!existsSync(srcPath)) {
      return c.json({ error: "File not found", code: "NOT_FOUND" }, 404);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // body optional for some actions
    }

    const action = body["action"] as string | undefined;
    if (!action) {
      return c.json({ error: "action is required", code: "BAD_REQUEST" }, 400);
    }

    switch (action) {
      case "requeue": {
        // Move file back to inbox, add requeued_from frontmatter
        const content = readFileSync(srcPath, "utf-8");
        const updated = insertFrontmatterKey(content, "requeued_from", folder);
        writeFileSync(srcPath, updated, "utf-8");

        const inboxDir = join(SINH_INPUTS, "inbox");
        ensureDir(inboxDir);
        renameSync(srcPath, join(inboxDir, filename));

        return c.json({ status: "requeued", file: filename, from: folder });
      }

      case "archive": {
        // Move file to done/
        const doneDir = join(SINH_INPUTS, "done");
        ensureDir(doneDir);
        renameSync(srcPath, join(doneDir, filename));

        return c.json({ status: "archived", file: filename, from: folder });
      }

      case "save-for-later": {
        // Only valid for approved folder
        if (folder !== "approved") {
          return c.json(
            { error: "save-for-later is only available for approved items", code: "BAD_REQUEST" },
            400
          );
        }
        const content = readFileSync(srcPath, "utf-8");
        const updated = insertFrontmatterKey(content, "saved_from", "approved");
        writeFileSync(srcPath, updated, "utf-8");

        const forLaterDir = join(SINH_INPUTS, "for-later");
        ensureDir(forLaterDir);
        renameSync(srcPath, join(forLaterDir, filename));

        return c.json({ status: "saved-for-later", file: filename });
      }

      case "append-section": {
        const title = body["title"] as string | undefined;
        const sectionContent = (body["content"] as string) ?? "";
        if (!title || title.trim().length === 0) {
          return c.json({ error: "title is required", code: "BAD_REQUEST" }, 400);
        }
        let result = readFileSync(srcPath, "utf-8");
        if (!result.endsWith("\n")) result = result + "\n";
        if (!result.endsWith("\n\n")) result = result + "\n";
        result = result + `### ${title.trim()}\n\n${sectionContent}\n`;
        writeFileSync(srcPath, result, "utf-8");

        return c.json({ status: "section-appended", file: filename, title: title.trim() });
      }

      default:
        return c.json({ error: `Unknown action: ${action}`, code: "BAD_REQUEST" }, 400);
    }
  });

  return app;
}
