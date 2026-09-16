import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { requireRole } from "../lib/auth";

const paymentMilestones = new Hono<{ Bindings: Env; Variables: Variables }>();

// Part D — Payment Tracking Overlay, with a live "days overdue" computed
// from invoice_raised_date when unpaid, matching the roadmap's promised
// "payment-aging view".
paymentMilestones.get("/project/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const { results } = await c.env.DB.prepare(
    `SELECT pm.*, st.name AS triggered_by_stage_name
     FROM payment_milestone pm LEFT JOIN stage_template st ON st.id = pm.triggered_by_stage_id
     WHERE pm.project_id = ? ORDER BY pm.seq`
  )
    .bind(projectId)
    .all();

  const today = new Date();
  const withAging = (results as any[]).map((r) => {
    let days_overdue: number | null = null;
    if (r.invoice_raised_date && !r.payment_received_date) {
      const raised = new Date(r.invoice_raised_date + "T00:00:00Z");
      days_overdue = Math.max(0, Math.round((today.getTime() - raised.getTime()) / 86400000));
    }
    return { ...r, days_overdue };
  });
  return c.json(withAging);
});

// Commercial/Accounts (Superadmin or a dept_head in Commercial/Accounts)
// update invoice/payment status. Kept permissive to dept_head + superadmin
// for MVP rather than hard-coding department names.
paymentMilestones.patch("/:id", requireRole("superadmin", "dept_head"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      invoice_raised_date: string;
      invoice_amount: number;
      payment_received_date: string;
      amount_received: number;
      status: string;
    }>
  >();

  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return c.json({ error: "nothing to update" }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE payment_milestone SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

export default paymentMilestones;
