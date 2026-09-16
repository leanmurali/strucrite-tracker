import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";
import { computeTask, thresholdsFromEnv } from "../lib/rag";

const projects = new Hono<{ Bindings: Env; Variables: Variables }>();

// List projects with a rolled-up RAG summary (counts by color across all
// applicable tasks) — powers the Part A "Master Project Register" screen.
projects.get("/", async (c) => {
  const { results: projectRows } = await c.env.DB.prepare(
    "SELECT id, name, client, contract_value, balance_value, po_date, status FROM project WHERE org_id = 1 ORDER BY po_date"
  ).all();

  const { results: taskRows } = await c.env.DB.prepare(
    "SELECT project_id, plan_date, actual_date, not_applicable FROM project_task"
  ).all();

  const thresholds = thresholdsFromEnv(c.env);
  const today = new Date();
  const summary: Record<number, { green: number; amber: number; red: number; na: number; total: number }> = {};
  for (const t of taskRows as any[]) {
    const s = (summary[t.project_id] ??= { green: 0, amber: 0, red: 0, na: 0, total: 0 });
    const computed = computeTask(t.plan_date, t.actual_date, !!t.not_applicable, today, thresholds);
    s.total++;
    if (computed.rag === "GREEN") s.green++;
    else if (computed.rag === "AMBER") s.amber++;
    else if (computed.rag === "RED") s.red++;
    else s.na++;
  }

  const out = (projectRows as any[]).map((p) => ({
    ...p,
    rag_summary: summary[p.id] ?? { green: 0, amber: 0, red: 0, na: 0, total: 0 },
    overall_rag: summary[p.id]?.red ? "RED" : summary[p.id]?.amber ? "AMBER" : "GREEN",
  }));

  return c.json(out);
});

projects.post("/", requireRole("superadmin"), async (c) => {
  const body = await c.req.json<{
    name: string;
    client?: string;
    contract_value?: number;
    balance_value?: number;
    po_date?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const res = await c.env.DB.prepare(
    "INSERT INTO project (org_id, name, client, contract_value, balance_value, po_date, status) VALUES (1, ?, ?, ?, ?, ?, 'active')"
  )
    .bind(body.name.trim(), body.client ?? null, body.contract_value ?? null, body.balance_value ?? null, body.po_date ?? null)
    .run();

  const projectId = res.meta.last_row_id as number;

  // Auto-seed the full 42-task tracker for the new project from
  // task_template, plus the 5 standard payment milestones — this is the
  // "one tracker per project, from the master framework" behaviour promised
  // in Part C of the Sep-11 design.
  const { results: templates } = await c.env.DB.prepare(
    "SELECT id, is_conditional FROM task_template WHERE org_id = 1 ORDER BY seq"
  ).all();
  const insertTask = c.env.DB.prepare(
    "INSERT INTO project_task (project_id, task_template_id, not_applicable) VALUES (?, ?, ?)"
  );
  await c.env.DB.batch((templates as any[]).map((t) => insertTask.bind(projectId, t.id, 0)));

  const paymentPoints = [
    ["Advance / Mobilisation", 1],
    ["Progress Payment", 2],
    ["Pre-Dispatch / Major Progress Payment", 3],
    ["Final Payment", 4],
    ["Retention Release", 5],
  ] as const;
  const insertPm = c.env.DB.prepare(
    "INSERT INTO payment_milestone (project_id, payment_point, seq, status) VALUES (?, ?, ?, 'pending')"
  );
  await c.env.DB.batch(paymentPoints.map(([point, seq]) => insertPm.bind(projectId, point, seq)));

  return c.json({ id: projectId }, 201);
});

export default projects;
