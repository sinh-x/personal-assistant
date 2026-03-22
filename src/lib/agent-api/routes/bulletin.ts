/**
 * Bulletin API routes — CRUD for active bulletins.
 *
 * GET   /api/bulletin        — list active bulletins
 * POST  /api/bulletin        — create a new bulletin
 * PATCH /api/bulletin/:id    — update/resolve a bulletin
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { BulletinStore } from "../../bulletins/store.js";
import type { BulletinBlock } from "../../bulletins/types.js";

export function bulletinRoutes(): Hono {
  const app = new Hono();
  const store = new BulletinStore();

  // GET /api/bulletin — list active bulletins
  app.get("/api/bulletin", (c: Context) => {
    try {
      const bulletins = store.readActive();
      return c.json({ bulletins, count: bulletins.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "LIST_FAILED" }, 500);
    }
  });

  // POST /api/bulletin — create bulletin
  app.post("/api/bulletin", async (c: Context) => {
    let body: {
      title?: string;
      block?: BulletinBlock;
      except?: string[];
      message?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    if (!body.title) {
      return c.json({ error: "title is required", code: "BAD_REQUEST" }, 400);
    }
    if (body.block === undefined) {
      return c.json({ error: "block is required", code: "BAD_REQUEST" }, 400);
    }

    try {
      const bulletin = store.create({
        title: body.title,
        block: body.block,
        except: body.except,
        body: body.message ?? "",
      });
      return c.json({ bulletin }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, code: "CREATE_FAILED" }, 400);
    }
  });

  // PATCH /api/bulletin/:id — update/resolve bulletin
  app.patch("/api/bulletin/:id", async (c: Context) => {
    const id = c.req.param("id") as string;
    let body: { status?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }

    if (body.status === "resolved") {
      const ok = store.resolve(id);
      if (!ok) {
        return c.json({ error: "Bulletin not found", code: "NOT_FOUND" }, 404);
      }
      return c.json({ success: true, id });
    }

    return c.json(
      { error: "Only status=resolved is supported for PATCH", code: "BAD_REQUEST" },
      400,
    );
  });

  return app;
}
