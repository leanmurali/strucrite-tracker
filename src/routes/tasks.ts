import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";
import { computeTask, computeEscalationTier, thresholdsFromEnv } from "../lib/rag";

const tasks = new Hono<{ Bindings: Env; Variables: Variables }>();

async function loadAndCompute(env: Env, projectId: number) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM v_project_task_detail WHERE project_id = ? ORDER BY task_seq`
  )
    .bind(projectId)
    .all();

  const { results: openDelays } = await env.DB.prepare(
    `SELECT project_task_id, reason, proposed_action, target_date, opened_at
     FROM delay_log WHERE closed_at IS NULL AND project_task_id IN
     (SELECT id FROM project_task WHERE project_id = ?)`
  )
    .bind(projectId)
    .all();
  const delayByTask = new Map<number, any>();
  for (const d of openDelays as any[]) delayByTask.set(d.project_task_id, d);

  const thresholds = thresholdsFromEnv(env);
  const today = new Date();
  // "Post QC Gate 4 / Final Inspection" per Part F §8.3 = anything in the
  // External/Client or Dispatch phases of the Part-B framework (stages 18-20
  // + QC Gate 4 itself) — from here on, every day of delay is idle cash.
  const isPostFinal = (row: any) =>
    row.stage_phase === "External / Client" ||
    row.stage_phase === "Dispatch" ||
    row.stage_name === "Final Inspection Gate";

  return (results as any[]).map((row) => {
    const computed = computeTask(row.plan_date, row.actual_date, !!row.not_applicable, today, thresholds);
    const tier = computeEscalationTier(computed.variance_days, isPostFinal(row), thresholds);
    return {
      ...row,
      ...computed,
      escalation_tier: tier,
      open_delay: delayByTask.get(row.project_task_id) ?? null,
    };
  });
}

tasks.get("/project/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  return c.json(await loadAndCompute(c.env, projectId));
});

// A Member's own worklist across all projects — "what do I own that's due
// or overdue" — independent of which project screen they're looking at.
tasks.get("/mine", async (c) => {
  const me = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM v_project_task_detail WHERE owner_user_id = ? ORDER BY plan_date`
  )
    .bind(me.id)
    .all();
  const thresholds = thresholdsFromEnv(c.env);
  const today = new Date();
  return c.json(
    (results as any[]).map((row) => ({
      ...row,
      ...computeTask(row.plan_date, row.actual_date, !!row.not_applicable, today, thresholds),
    }))
  );
});

// Dept Head / Superadmin: assign an owner and/or set the plan date for a
// task. Members are explicitly NOT allowed to touch plan_date — that keeps
// the SLA baseline honest (see spec §5).
tasks.patch("/:id/assign", requireRole("superadmin", "dept_head"), async (c) => {
  const me = c.get("user");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ owner_user_id?: number; plan_date?: string; not_applicable?: boolean }>();

  const task = await c.env.DB.prepare(
    `SELECT pt.id, tt.owner_department_id FROM project_task pt
     JOIN task_template tt ON tt.id = pt.task_template_id WHERE pt.id = ?`
  )
    .bind(id)
    .first<{ id: number; owner_department_id: number }>();
  if (!task) return c.json({ error: "task not found" }, 404);
  if (me.role === "dept_head" && task.owner_department_id !== me.department_id) {
    return c.json({ error: "You can only assign tasks owned by your own department" }, 403);
  }

  const sets: string[] = [];
  const values: any[] = [];
  const logEntries: [string, any, any][] = [];

  if (body.owner_user_id !== undefined) {
    sets.push("owner_user_id = ?");
    values.push(body.owner_user_id);
    logEntries.push(["owner_user_id", null, body.owner_user_id]);
  }
  if (body.plan_date !== undefined) {
    sets.push("plan_date = ?");
    values.push(body.plan_date);
    logEntries.push(["plan_date", null, body.plan_date]);
  }
  if (body.not_applicable !== undefined) {
    sets.push("not_applicable = ?");
    values.push(body.not_applicable ? 1 : 0);
    logEntries.push(["not_applicable", null, body.not_applicable ? "1" : "0"]);
  }
  if (sets.length === 0) return c.json({ error: "nothing to update" }, 400);

  sets.push("updated_at = datetime('now')");
  values.push(id);
  await c.env.DB.prepare(`UPDATE project_task SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();

  const insertLog = c.env.DB.prepare(
    "INSERT INTO task_update_log (project_task_id, user_id, channel, field, old_value, new_value) VALUES (?, ?, 'web', ?, ?, ?)"
  );
  await c.env.DB.batch(logEntries.map(([f, o, n]) => insertLog.bind(id, me.id, f, o, String(n))));

  return c.json({ ok: true });
});

// Member: report progress on a task they own. If actual_date is later than
// plan_date, `reason` and `proposed_action` are REQUIRED in the same call —
// this is the single biggest data-quality fix over the spreadsheet (Part E,
// "every Red/Amber row gets one row in the Gap & Action Log").
tasks.patch("/:id/update", requireRole("superadmin", "dept_head", "member"), async (c) => {
  const me = c.get("user");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    actual_date?: string;
    reason?: string;
    proposed_action?: string;
    target_date?: string;
  }>();

  const task = await c.env.DB.prepare(
    "SELECT id, plan_date, owner_user_id FROM project_task WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; plan_date: string | null; owner_user_id: number | null }>();
  if (!task) return c.json({ error: "task not found" }, 404);
  if (me.role === "member" && task.owner_user_id !== me.id) {
    return c.json({ error: "You can only update tasks you own" }, 403);
  }
  if (body.actual_date === undefined) return c.json({ error: "actual_date is required" }, 400);

  const isLate = task.plan_date != null && body.actual_date > task.plan_date;
  if (isLate && (!body.reason?.trim() || !body.proposed_action?.trim())) {
    return c.json(
      {
        error:
          "This task is later than its plan date. Please provide both a reason for the delay and a proposed action before saving.",
        requires_delay_log: true,
      },
      422
    );
  }

  await c.env.DB.prepare("UPDATE project_task SET actual_date = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(body.actual_date, id)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO task_update_log (project_task_id, user_id, channel, field, old_value, new_value) VALUES (?, ?, 'web', 'actual_date', NULL, ?)"
  )
    .bind(id, me.id, body.actual_date)
    .run();

  if (isLate) {
    await c.env.DB.prepare(
      `INSERT INTO delay_log (project_task_id, reason, proposed_action, action_owner_id, target_date, opened_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, body.reason, body.proposed_action, me.id, body.target_date ?? null, me.id)
      .run();
  }

  return c.json({ ok: true, was_late: isLate });
});

// Close an open delay-log entry once the corrective action is done (Part E
// row moves from open to closed — feeds the Weekly Review's "status of
// every open row in the Action Log").
tasks.patch("/delay-log/:id/close", requireRole("superadmin", "dept_head"), async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE delay_log SET closed_at = datetime('now'), closed_by = ? WHERE id = ?")
    .bind(me.id, id)
    .run();
  return c.json({ ok: true });
});

export default tasks;
