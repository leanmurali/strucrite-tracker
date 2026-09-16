import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { computeTask, thresholdsFromEnv, type Rag } from "../lib/rag";

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

interface Row {
  project_task_id: number;
  project_id: number;
  project_name: string;
  task_seq: number;
  task_name: string;
  stage_name: string | null;
  stage_phase: string | null;
  owner_department_id: number | null;
  owner_department_name: string | null;
  owner_user_id: number | null;
  owner_user_name: string | null;
  plan_date: string | null;
  actual_date: string | null;
  not_applicable: number;
}

async function loadAllComputed(env: Env) {
  const { results } = await env.DB.prepare("SELECT * FROM v_project_task_detail").all();
  const thresholds = thresholdsFromEnv(env);
  const today = new Date();
  return (results as unknown as Row[]).map((row) => ({
    ...row,
    ...computeTask(row.plan_date, row.actual_date, !!row.not_applicable, today, thresholds),
  }));
}

function emptyBucket() {
  return { green: 0, amber: 0, red: 0, na: 0, total: 0 };
}
function bump(bucket: ReturnType<typeof emptyBucket>, rag: Rag) {
  bucket.total++;
  if (rag === "GREEN") bucket.green++;
  else if (rag === "AMBER") bucket.amber++;
  else if (rag === "RED") bucket.red++;
  else bucket.na++;
}

// Portfolio-wide headline numbers — the same shape as the Sep-16 manual
// analysis, but always live.
dashboard.get("/portfolio", async (c) => {
  const rows = await loadAllComputed(c.env);
  const overall = emptyBucket();
  let completed = 0;
  let applicable = 0;
  let overdueNoActual = 0;
  for (const r of rows) {
    bump(overall, r.rag);
    if (r.rag !== "N/A") {
      applicable++;
      if (r.status.startsWith("COMPLETED")) completed++;
      if (r.status === "OVERDUE_PENDING") overdueNoActual++;
    }
  }

  const { results: projectRows } = await c.env.DB.prepare(
    "SELECT id, contract_value, balance_value FROM project WHERE org_id = 1"
  ).all();
  const projectRag = new Map<number, Rag>();
  for (const r of rows) {
    const cur = projectRag.get(r.project_id);
    if (r.rag === "RED") projectRag.set(r.project_id, "RED");
    else if (r.rag === "AMBER" && cur !== "RED") projectRag.set(r.project_id, "AMBER");
    else if (!cur) projectRag.set(r.project_id, r.rag);
  }
  let valueAtRisk = 0;
  for (const p of projectRows as any[]) {
    if (projectRag.get(p.id) === "RED") valueAtRisk += p.balance_value ?? 0;
  }

  return c.json({
    total_activities: overall.total,
    applicable_activities: applicable,
    percent_delivered: applicable ? Math.round((completed / applicable) * 1000) / 10 : 0,
    overdue_no_actual: overdueNoActual,
    rag: overall,
    projects_total: (projectRows as any[]).length,
    projects_red: [...projectRag.values()].filter((v) => v === "RED").length,
    projects_amber: [...projectRag.values()].filter((v) => v === "AMBER").length,
    projects_green: [...projectRag.values()].filter((v) => v === "GREEN").length,
    value_at_risk: valueAtRisk,
  });
});

// Department view — "Production is the most overdue-heavy department",
// but continuously live instead of a one-time manual tally.
dashboard.get("/departments", async (c) => {
  const rows = await loadAllComputed(c.env);
  const byDept = new Map<string, ReturnType<typeof emptyBucket>>();
  for (const r of rows) {
    const key = r.owner_department_name ?? "Unassigned";
    if (!byDept.has(key)) byDept.set(key, emptyBucket());
    bump(byDept.get(key)!, r.rag);
  }
  return c.json([...byDept.entries()].map(([department, counts]) => ({ department, ...counts })));
});

// Member view — workload and delay pattern per individual owner.
dashboard.get("/members", async (c) => {
  const rows = await loadAllComputed(c.env);
  const byMember = new Map<string, ReturnType<typeof emptyBucket>>();
  for (const r of rows) {
    if (!r.owner_user_id) continue;
    const key = r.owner_user_name ?? `User #${r.owner_user_id}`;
    if (!byMember.has(key)) byMember.set(key, emptyBucket());
    bump(byMember.get(key)!, r.rag);
  }
  return c.json([...byMember.entries()].map(([member, counts]) => ({ member, ...counts })));
});

// Stage funnel — how many projects are currently sitting in each of the 24
// Part-B stages right now (the "current stage" = the earliest,
// not-yet-completed, applicable task in sequence for that project).
dashboard.get("/stage-funnel", async (c) => {
  const rows = await loadAllComputed(c.env);
  const byProject = new Map<number, Row[]>();
  for (const r of rows as any[]) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id)!.push(r);
  }
  const stageCounts = new Map<string, number>();
  for (const [, tasks] of byProject) {
    const sorted = tasks.slice().sort((a: any, b: any) => a.task_seq - b.task_seq);
    const current = sorted.find((t: any) => t.rag !== "N/A" && !t.status.startsWith("COMPLETED"));
    const stageName = current?.stage_name ?? "Complete / no open stage";
    stageCounts.set(stageName, (stageCounts.get(stageName) ?? 0) + 1);
  }
  return c.json([...stageCounts.entries()].map(([stage, projects]) => ({ stage, projects })));
});

// Payment aging — total outstanding and days-overdue across all projects
// (Part D's promised view).
dashboard.get("/payment-aging", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT project_id, payment_point, invoice_amount, amount_received, invoice_raised_date, payment_received_date FROM payment_milestone"
  ).all();
  const today = new Date();
  let totalOutstanding = 0;
  let items: any[] = [];
  for (const r of results as any[]) {
    if (!r.invoice_amount || r.payment_received_date) continue;
    const outstanding = (r.invoice_amount ?? 0) - (r.amount_received ?? 0);
    if (outstanding <= 0) continue;
    totalOutstanding += outstanding;
    const days_overdue = r.invoice_raised_date
      ? Math.max(0, Math.round((today.getTime() - new Date(r.invoice_raised_date + "T00:00:00Z").getTime()) / 86400000))
      : null;
    items.push({ ...r, outstanding, days_overdue });
  }
  return c.json({ total_outstanding: totalOutstanding, items });
});

// Weekly/Monthly review digest — auto-generated version of the Part F
// meeting agenda: Reds/Ambers by exception, plus every open Part-E action.
dashboard.get("/digest", async (c) => {
  const rows = await loadAllComputed(c.env);
  const exceptions = rows
    .filter((r) => r.rag === "RED" || r.rag === "AMBER")
    .map((r) => ({
      project: r.project_name,
      task: r.task_name,
      owner: r.owner_user_name,
      department: r.owner_department_name,
      rag: r.rag,
      status: r.status,
      variance_days: r.variance_days,
    }));

  const { results: openActions } = await c.env.DB.prepare(
    `SELECT dl.id, p.name AS project, tt.name AS task, dl.reason, dl.proposed_action,
            dl.target_date, u.name AS action_owner
     FROM delay_log dl
     JOIN project_task pt ON pt.id = dl.project_task_id
     JOIN project p ON p.id = pt.project_id
     JOIN task_template tt ON tt.id = pt.task_template_id
     LEFT JOIN user u ON u.id = dl.action_owner_id
     WHERE dl.closed_at IS NULL
     ORDER BY dl.target_date`
  ).all();

  return c.json({ exceptions, open_actions: openActions });
});

export default dashboard;
