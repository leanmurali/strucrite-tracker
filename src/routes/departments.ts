import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";

const departments = new Hono<{ Bindings: Env; Variables: Variables }>();

// Everyone authenticated can list departments (needed for dropdowns).
departments.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name FROM department WHERE org_id = 1 ORDER BY name"
  ).all();
  return c.json(results);
});

// Only Superadmin can create/rename/remove departments.
departments.post("/", requireRole("superadmin"), async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const res = await c.env.DB.prepare("INSERT INTO department (org_id, name) VALUES (1, ?)")
    .bind(body.name.trim())
    .run();
  return c.json({ id: res.meta.last_row_id, name: body.name.trim() }, 201);
});

departments.patch("/:id", requireRole("superadmin"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name: string }>();
  await c.env.DB.prepare("UPDATE department SET name = ? WHERE id = ?").bind(body.name, id).run();
  return c.json({ ok: true });
});

export default departments;
