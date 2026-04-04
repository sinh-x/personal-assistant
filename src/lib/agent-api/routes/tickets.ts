/**
 * Ticket API routes — CRUD and board view.
 *
 * GET    /api/tickets              — list tickets with optional query filters
 * POST   /api/tickets              — create a new ticket
 * GET    /api/tickets/:id          — get a single ticket by ID
 * GET    /api/tickets/:id/review   — review context: ticket + doc_ref_url + attachment_urls
 * PATCH  /api/tickets/:id          — update ticket fields
 * GET    /api/board                — board view grouped by status (project optional)
 * GET    /api/projects             — full project metadata + active ticket counts
 *
 * Comment routes:
 * POST   /api/tickets/:id/comments              — add a comment
 * PATCH  /api/tickets/:id/comments/:commentId   — edit a comment
 * DELETE /api/tickets/:id/comments/:commentId   — delete a comment (204)
 *
 * Attachment routes:
 * POST   /api/tickets/:id/attachments           — add an attachment path
 * POST   /api/tickets/:id/attachments/upload    — upload a file as an attachment (multipart)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { marked } from "marked";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { TicketStore } from "../../tickets/index.js";
import { validateAuthor, validateAssignee } from "../../tickets/validate.js";
import { buildBoardView } from "../../tickets/board.js";
import type { CreateTicketInput, UpdateTicketInput, Comment } from "../../tickets/types.js";
import { listRepos } from "../../repos.js";
import { validateSandboxPath } from "../utils/sandbox.js";

export function ticketRoutes(): Hono {
  const app = new Hono();
  const store = new TicketStore();

  // GET /api/tickets — list with query filters
  app.get("/api/tickets", (c: Context) => {
    const filters: {
      project?: string;
      status?: string;
      assignee?: string;
      priority?: string;
      type?: string;
      tags?: string[];
      excludeTags?: string[];
      search?: string;
    } = {};

    const project = c.req.query("project");
    const status = c.req.query("status");
    const assignee = c.req.query("assignee");
    const priority = c.req.query("priority");
    const type = c.req.query("type");
    const tagsParam = c.req.query("tags");
    const excludeTagsParam = c.req.query("excludeTags");
    const search = c.req.query("search");

    if (project) filters.project = project;
    if (status) filters.status = status;
    if (assignee) filters.assignee = assignee;
    if (priority) filters.priority = priority;
    if (type) filters.type = type;
    if (tagsParam) filters.tags = tagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    if (excludeTagsParam) filters.excludeTags = excludeTagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    if (search) filters.search = search;

    try {
      const tickets = store.list(filters);
      return c.json({ tickets, count: tickets.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "LIST_FAILED" }, 500);
    }
  });

  // POST /api/tickets — create ticket
  app.post("/api/tickets", async (c: Context) => {
    let body: CreateTicketInput & { actor?: string; team?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    const actor = body.actor ?? "api";
    const { actor: _actor, team, ...input } = body;

    // F5: If assignee is missing but team is provided, use team as assignee
    if (!input.assignee && team) {
      input.assignee = team;
    }

    // F4: Require assignee (or team fallback already applied above)
    if (!input.assignee) {
      return c.json(
        { error: "assignee is required (or provide team field)", code: "BAD_REQUEST" },
        400
      );
    }

    try {
      validateAssignee(input.assignee);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err), code: "BAD_REQUEST" },
        400
      );
    }

    try {
      const ticket = store.create(input as CreateTicketInput, actor);
      return c.json({ ticket }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "CREATE_FAILED" }, 400);
    }
  });

  // GET /api/tickets/:id/review — review context: ticket + document links
  // F9: Returns doc_refs array with generated URLs for each entry
  app.get("/api/tickets/:id/review", (c: Context) => {
    const id = c.req.param("id") as string;
    const ticket = store.get(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found", code: "NOT_FOUND" }, 404);
    }
    const doc_refs = (ticket.doc_refs ?? []).map((r) => ({
      ...r,
      url: `/api/documents?path=${encodeURIComponent(r.path)}`,
    }));
    return c.json({ ticket, doc_refs });
  });

  // GET /api/tickets/:id — get single ticket
  // Supports ?render=html query param to return content fields as rendered HTML
  app.get("/api/tickets/:id", (c: Context) => {
    const id = c.req.param("id") as string;
    const renderHtml = c.req.query("render") === "html";
    const ticket = store.get(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found", code: "NOT_FOUND" }, 404);
    }
    if (renderHtml) {
      // Render content fields to HTML using marked
      const renderToHtml = (content: string): string => {
        if (!content) return "";
        try {
          return marked.parse(content, { async: false }) as string;
        } catch {
          return content;
        }
      };
      const htmlTicket = {
        ...ticket,
        summary: renderToHtml(ticket.summary ?? ""),
        description: renderToHtml(ticket.description ?? ""),
        comments: (ticket.comments ?? []).map((comment: Comment) => ({
          ...comment,
          content: renderToHtml(comment.content),
        })),
      };
      return c.json({ ticket: htmlTicket });
    }
    return c.json({ ticket });
  });

  // PATCH /api/tickets/:id — update ticket fields
  app.patch("/api/tickets/:id", async (c: Context) => {
    const id = c.req.param("id") as string;
    let body: UpdateTicketInput & { actor?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    const actor = body.actor ?? "api";
    const { actor: _actor, ...input } = body;

    if ((input as UpdateTicketInput).assignee) {
      try {
        validateAssignee((input as UpdateTicketInput).assignee!);
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err), code: "BAD_REQUEST" },
          400
        );
      }
    }

    try {
      const ticket = store.update(id, input as UpdateTicketInput, actor);
      return c.json({ ticket });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found") || message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "UPDATE_FAILED" }, 400);
    }
  });

  // POST /api/tickets/:id/comments — add a comment
  app.post("/api/tickets/:id/comments", async (c: Context) => {
    const id = c.req.param("id") as string;
    let body: { author: string; content: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }
    if (!body.author || !body.content) {
      return c.json(
        { error: "author and content are required", code: "BAD_REQUEST" },
        400
      );
    }
    try {
      validateAuthor(body.author);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err), code: "BAD_REQUEST" },
        400
      );
    }
    try {
      const { ticket, comment } = store.addComment(id, body.author, body.content);
      return c.json({ ticket, comment }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "COMMENT_FAILED" }, 400);
    }
  });

  // PATCH /api/tickets/:id/comments/:commentId — edit a comment
  app.patch("/api/tickets/:id/comments/:commentId", async (c: Context) => {
    const id = c.req.param("id") as string;
    const commentId = c.req.param("commentId") as string;
    let body: { content: string; actor?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }
    if (!body.content) {
      return c.json({ error: "content is required", code: "BAD_REQUEST" }, 400);
    }
    try {
      const { comment } = store.editComment(id, commentId, body.content, body.actor);
      return c.json({ comment });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr =
        (err as { stderr?: Buffer }).stderr?.toString() ?? "";
      if (message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      if (stderr.includes("Comment not found")) {
        return c.json({ error: "Comment not found", code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "EDIT_FAILED" }, 400);
    }
  });

  // DELETE /api/tickets/:id/comments/:commentId — delete a comment
  app.delete("/api/tickets/:id/comments/:commentId", async (c: Context) => {
    const id = c.req.param("id") as string;
    const commentId = c.req.param("commentId") as string;
    const actor = c.req.query("actor") ?? "api";
    try {
      store.deleteComment(id, commentId, actor);
      return new Response(null, { status: 204 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr =
        (err as { stderr?: Buffer }).stderr?.toString() ?? "";
      if (message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      if (stderr.includes("Comment not found")) {
        return c.json({ error: "Comment not found", code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "DELETE_FAILED" }, 400);
    }
  });

  // POST /api/tickets/:id/attachments — add an attachment path
  // F12: Delegates to add_doc_ref with type: 'attachment' (deprecated attach path, kept for compatibility)
  app.post("/api/tickets/:id/attachments", async (c: Context) => {
    const id = c.req.param("id") as string;
    let body: { path: string; actor?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }
    if (!body.path) {
      return c.json({ error: "path is required", code: "BAD_REQUEST" }, 400);
    }
    const actor = body.actor ?? "api";
    try {
      const ticket = store.update(id, { add_doc_ref: { type: "attachment", path: body.path } }, actor);
      return c.json({ ticket });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "ATTACH_FAILED" }, 400);
    }
  });

  // POST /api/tickets/:id/attachments/upload — upload a file as an attachment (multipart)
  // Accepts multipart/form-data with a 'file' field; saves to ~/Documents/ai-usage/attachments/<ticket-id>/
  // and links it to the ticket via add_doc_ref with type: 'attachment'.
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

  app.post("/api/tickets/:id/attachments/upload", async (c: Context) => {
    const id = c.req.param("id") as string;

    // Verify ticket exists before processing upload
    const existingTicket = store.get(id);
    if (!existingTicket) {
      return c.json({ error: "Ticket not found", code: "NOT_FOUND" }, 404);
    }

    // Parse multipart body with 5 MB limit
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true, maxSize: MAX_FILE_SIZE });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("body")) {
        return c.json({ error: "File too large", code: "PAYLOAD_TOO_LARGE" }, 413);
      }
      return c.json({ error: "Failed to parse body", code: "BAD_REQUEST" }, 400);
    }

    const fileField = body["file"];

    // F8: Return 400 if file field is missing or not a File instance
    if (!fileField || !(fileField instanceof File)) {
      return c.json({ error: "file field is required and must be a file", code: "BAD_REQUEST" }, 400);
    }

    const file = fileField;

    // F10: Return 413 if file exceeds size limit
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: "File too large", code: "PAYLOAD_TOO_LARGE" }, 413);
    }

    // F4/F9: Validate file extension against whitelist (exclude .svg)
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return c.json(
        { error: `File extension '${ext}' is not allowed. Allowed: png, jpg, jpeg, gif, webp`, code: "BAD_REQUEST" },
        400
      );
    }

    // F11: Sanitize filename to prevent path traversal
    // Strip directory components and dangerous characters
    const baseName = file.name.split("/").pop()!.split("\\").pop()!;
    const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = Date.now();
    const storedFilename = `${timestamp}-${sanitized}`;

    // Build storage path: ~/Documents/ai-usage/attachments/<ticket-id>/<timestamp>-<filename>
    const sandboxRoot = join(homedir(), "Documents/ai-usage");
    const attachmentDir = join(sandboxRoot, "attachments", id);
    const storedPath = join(attachmentDir, storedFilename);
    const relativeDocRefPath = `attachments/${id}/${storedFilename}`;

    // Defense-in-depth: validate the final path is inside sandbox
    let validatedPath: string;
    try {
      validatedPath = validateSandboxPath(storedPath);
    } catch {
      return c.json({ error: "Invalid storage path", code: "BAD_REQUEST" }, 400);
    }

    // F5: Create directory if it doesn't exist
    if (!existsSync(attachmentDir)) {
      await mkdir(attachmentDir, { recursive: true });
    }

    // F5: Save file to storage
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await writeFile(validatedPath, buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to save file: ${message}`, code: "UPLOAD_FAILED" }, 500);
    }

    // F6: Add doc_ref to ticket
    const actor = "api";
    try {
      store.update(id, { add_doc_ref: { type: "attachment", path: relativeDocRefPath } }, actor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to link attachment: ${message}`, code: "ATTACH_FAILED" }, 400);
    }

    // F7: Return JSON response with docRef on success 201
    return c.json({ docRef: relativeDocRefPath }, 201);
  });

  // GET /api/projects — full project metadata + active ticket counts
  app.get("/api/projects", (c: Context) => {
    try {
      const repos = listRepos();
      const counts = store.getProjectCounts();
      const countMap = new Map(counts.map(({ key, count }) => [key, count]));

      const projects = repos
        .filter((r) => r.prefix)
        .map((r) => ({
          key: r.name,
          prefix: r.prefix!,
          description: r.description ?? "",
          path: r.path,
          activeTicketCount: countMap.get(r.name) ?? 0,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

      return c.json({ projects });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "PROJECTS_FAILED" }, 500);
    }
  });

  // GET /api/board — board view grouped by status (project optional)
  app.get("/api/board", (c: Context) => {
    const project = c.req.query("project") || undefined;

    const DEFAULT_EXCLUDE_TAGS = ["backlog", "archived"];
    const DEFAULT_EXCLUDE_TYPES = ["fyi", "work-report"];
    const filters: { assignee?: string; excludeTags?: string[]; excludeTypes?: string[] } = {};
    const assignee = c.req.query("assignee");
    const excludeTagsParam = c.req.query("excludeTags");
    const excludeTypesParam = c.req.query("excludeTypes");
    if (assignee) filters.assignee = assignee;
    filters.excludeTags = excludeTagsParam
      ? excludeTagsParam.split(",").map((t) => t.trim()).filter(Boolean)
      : DEFAULT_EXCLUDE_TAGS;
    filters.excludeTypes = excludeTypesParam !== undefined
      ? excludeTypesParam.split(",").map((t) => t.trim()).filter(Boolean)
      : DEFAULT_EXCLUDE_TYPES;

    try {
      const board = buildBoardView(project, filters);
      return c.json({ board });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "BOARD_FAILED" }, 500);
    }
  });

  return app;
}
