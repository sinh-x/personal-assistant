/**
 * Ideas route — create idea files in ~/Documents/ai-usage/sinh-inputs/ideas/
 *
 * POST /api/ideas — create a new idea.
 *   Body: {title: string, content: string, category?: string, effort?: string,
 *          what?: string, why?: string, who?: string, notes?: string, tags?: string|string[]}
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const IDEAS_DIR = join(AI_USAGE, "sinh-inputs", "ideas");

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimestamp(d: Date): string {
  const date = formatDate(d);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${h}:${min}`;
}

function formatTags(raw: unknown): string {
  if (Array.isArray(raw)) {
    const tags = (raw as unknown[])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    return tags.length > 0 ? tags.map((t) => `\`${t}\``).join(" ") : "(none yet)";
  }
  if (typeof raw === "string" && raw.trim()) {
    const tags = raw.trim().split(/\s+/).filter((t) => t.length > 0);
    return tags.length > 0 ? tags.map((t) => `\`${t}\``).join(" ") : "(none yet)";
  }
  return "(none yet)";
}

export function ideasRoutes(): Hono {
  const app = new Hono();

  // POST /api/ideas — create a new idea
  app.post("/api/ideas", async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    const title = body["title"] as string | undefined;
    if (!title || !title.trim()) {
      return c.json({ error: "title is required", code: "BAD_REQUEST" }, 400);
    }

    const category = ((body["category"] as string | undefined) ?? "personal").trim();
    const effort = ((body["effort"] as string | undefined) ?? "M").trim();
    const what = (body["what"] as string | undefined)?.trim();
    const why = (body["why"] as string | undefined)?.trim();
    const who = ((body["who"] as string | undefined) ?? "Sinh").trim();
    const notes = (body["notes"] as string | undefined)?.trim();
    const tagsFormatted = formatTags(body["tags"]);

    const now = new Date();
    const today = formatDate(now);
    const timestamp = formatTimestamp(now);
    const slug = slugify(title.trim());

    if (!existsSync(IDEAS_DIR)) {
      mkdirSync(IDEAS_DIR, { recursive: true });
    }

    // Unique filename (handle collision with counter)
    let filename = `${today}-${slug}.md`;
    if (existsSync(join(IDEAS_DIR, filename))) {
      let counter = 2;
      while (existsSync(join(IDEAS_DIR, `${today}-${slug}-${counter}.md`))) {
        counter++;
      }
      filename = `${today}-${slug}-${counter}.md`;
    }

    // Build file content matching pa idea CLI format
    const lines: string[] = [
      `# Idea: ${title.trim()}`,
      "",
      `> **Date:** ${timestamp}`,
      `> **Category:** ${category}`,
      `> **Status:** new`,
      `> **Effort:** ${effort}`,
      "",
      "## What",
      what && what.length > 0 ? what : title.trim(),
      "",
      "## Why",
      why && why.length > 0 ? why : "_(not specified)_",
      "",
      "## Who",
      who,
      "",
      "## Notes",
      notes && notes.length > 0 ? notes : "_(none)_",
      "",
      "## Tags",
      tagsFormatted,
      "",
    ];

    writeFileSync(join(IDEAS_DIR, filename), lines.join("\n"), "utf-8");

    return c.json({ status: "created", file: filename });
  });

  return app;
}
