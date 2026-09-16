import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";

const frameworks = new Hono<{ Bindings: Env; Variables: Variables }>();

// Part B — 24-stage master framework. Read-only for everyone; only
// Superadmin edits the master reference data (per spec §5).
frameworks.get("/stages", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT st.*, d.name AS owner_department_name FROM stage_template st
     LEFT JOIN department d ON d.id = st.owner_department_id
     WHERE st.org_id = 1 ORDER BY st.seq`
  ).all();
  return c.json(results);
});

frameworks.patch("/stages/:id", requireRole("superadmin"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; key_activities: string; owner_department_id: number; deliverable_evidence: string }>>();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return c.json({ error: "nothing to update" }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE stage_template SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

// The 42-activity task template (the canonical per-task list, per the
// 16-Sep decision to use the QC-workbook granularity as the unit Members
// update, tagged to a Part-B stage for roll-up reporting).
frameworks.get("/tasks", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT tt.*, d.name AS owner_department_name, st.name AS stage_name
     FROM task_template tt
     LEFT JOIN department d ON d.id = tt.owner_department_id
     LEFT JOIN stage_template st ON st.id = tt.stage_template_id
     WHERE tt.org_id = 1 ORDER BY tt.seq`
  ).all();
  return c.json(results);
});

frameworks.patch("/tasks/:id", requireRole("superadmin"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; owner_department_id: number; stage_template_id: number; is_conditional: boolean }>>();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    fields.push(`${k} = ?`);
    values.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (fields.length === 0) return c.json({ error: "nothing to update" }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE task_template SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

export default frameworks;
