/**
 * Ticket API routes — CRUD and board view.
 *
 * GET    /api/tickets              — list tickets with optional query filters
 * POST   /api/tickets              — create a new ticket
 * GET    /api/tickets/:id          — get a single ticket by ID
 * PATCH  /api/tickets/:id          — update ticket fields
 * GET    /api/board                — board view grouped by status (project required)
 *
 * Comment routes:
 * POST   /api/tickets/:id/comments              — add a comment
 * PATCH  /api/tickets/:id/comments/:commentId   — edit a comment
 * DELETE /api/tickets/:id/comments/:commentId   — delete a comment (204)
 *
 * Attachment routes:
 * POST   /api/tickets/:id/attachments           — add an attachment path
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { TicketStore } from "../../tickets/index.js";
import { validateAuthor } from "../../tickets/validate.js";
import { buildBoardView } from "../../tickets/board.js";
import type { CreateTicketInput, UpdateTicketInput } from "../../tickets/types.js";

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
    } = {};

    const project = c.req.query("project");
    const status = c.req.query("status");
    const assignee = c.req.query("assignee");
    const priority = c.req.query("priority");
    const type = c.req.query("type");

    if (project) filters.project = project;
    if (status) filters.status = status;
    if (assignee) filters.assignee = assignee;
    if (priority) filters.priority = priority;
    if (type) filters.type = type;

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
    let body: CreateTicketInput & { actor?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    const actor = body.actor ?? "api";
    const { actor: _actor, ...input } = body;

    try {
      const ticket = store.create(input as CreateTicketInput, actor);
      return c.json({ ticket }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "CREATE_FAILED" }, 400);
    }
  });

  // GET /api/tickets/:id — get single ticket
  app.get("/api/tickets/:id", (c: Context) => {
    const id = c.req.param("id") as string;
    const ticket = store.get(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found", code: "NOT_FOUND" }, 404);
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
      const ticket = store.attach(id, body.path, actor);
      return c.json({ ticket });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Ticket not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message, code: "ATTACH_FAILED" }, 400);
    }
  });

  // GET /api/board — board view (project required, team optional)
  app.get("/api/board", (c: Context) => {
    const project = c.req.query("project");
    if (!project) {
      return c.json(
        { error: "project query param is required", code: "BAD_REQUEST" },
        400,
      );
    }

    const filters: { assignee?: string } = {};
    const assignee = c.req.query("assignee");
    if (assignee) filters.assignee = assignee;

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
