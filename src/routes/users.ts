import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";

const users = new Hono<{ Bindings: Env; Variables: Variables }>();

// Superadmin sees everyone; Dept Head sees their own department only.
users.get("/", async (c) => {
  const me = c.get("user");
  if (me.role === "superadmin") {
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.department_id, d.name AS department_name
       FROM user u LEFT JOIN department d ON d.id = u.department_id
       WHERE u.org_id = 1 ORDER BY u.name`
    ).all();
    return c.json(results);
  }
  if (me.role === "dept_head") {
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.department_id, d.name AS department_name
       FROM user u LEFT JOIN department d ON d.id = u.department_id
       WHERE u.org_id = 1 AND u.department_id = ? ORDER BY u.name`
    )
      .bind(me.department_id)
      .all();
    return c.json(results);
  }
  // Members only see who owns what for context (name/department), not full admin fields.
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, d.name AS department_name FROM user u
     LEFT JOIN department d ON d.id = u.department_id WHERE u.org_id = 1 ORDER BY u.name`
  ).all();
  return c.json(results);
});

// Superadmin: any role, any department. Dept Head: only 'member' role, only
// within their own department (matches "Department Head: Add members/roles"
// scoped to their team, per the spec).
users.post("/", requireRole("superadmin", "dept_head"), async (c) => {
  const me = c.get("user");
  const body = await c.req.json<{
    email: string;
    name: string;
    department_id: number;
    role: string;
  }>();

  if (!body.email?.trim() || !body.name?.trim()) {
    return c.json({ error: "email and name are required" }, 400);
  }

  let role = body.role;
  let department_id = body.department_id;

  if (me.role === "dept_head") {
    role = "member"; // dept heads cannot grant superadmin/dept_head/project_owner
    department_id = me.department_id!;
  } else if (!["superadmin", "dept_head", "member", "project_owner"].includes(role)) {
    return c.json({ error: "invalid role" }, 400);
  }

  try {
    const res = await c.env.DB.prepare(
      "INSERT INTO user (org_id, email, name, department_id, role) VALUES (1, ?, ?, ?, ?)"
    )
      .bind(body.email.trim().toLowerCase(), body.name.trim(), department_id, role)
      .run();
    return c.json({ id: res.meta.last_row_id }, 201);
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return c.json({ error: `A user with email ${body.email} already exists` }, 409);
    }
    throw e;
  }
});

users.patch("/:id", requireRole("superadmin", "dept_head"), async (c) => {
  const me = c.get("user");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Partial<{ name: string; role: string; department_id: number; active: boolean }>>();

  if (me.role === "dept_head") {
    // Dept heads may only edit members inside their own department, and may
    // not change role or department (that's a Superadmin action).
    const target = await c.env.DB.prepare("SELECT department_id, role FROM user WHERE id = ?").bind(id).first();
    if (!target || target.department_id !== me.department_id || target.role !== "member") {
      return c.json({ error: "You can only edit members in your own department" }, 403);
    }
    delete body.role;
    delete body.department_id;
  }

  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    fields.push(`${k} = ?`);
    values.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (fields.length === 0) return c.json({ error: "nothing to update" }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE user SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

export default users;
