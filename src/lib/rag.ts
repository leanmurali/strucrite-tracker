/**
 * Single source of truth for STATUS / VARIANCE / RAG. Used by every API
 * route and dashboard query so the number a Member sees on their task and
 * the number a Superadmin sees on the portfolio dashboard can never drift
 * apart the way they did in the spreadsheet.
 *
 * Thresholds match the escalation ladder agreed 11-Sep-2026 (Part F,
 * Section 8.3): 0-3 days = Amber (self-flag), 4+ days = Red (mandatory
 * Gap & Action Log entry; beyond 7 days additionally escalates to the
 * Monthly Systemic Review — that's a routing decision, not a 4th color,
 * see computeEscalationTier below).
 */

export type Rag = "GREEN" | "AMBER" | "RED" | "N/A";

export type TaskStatus =
  | "COMPLETED_ON_TIME"
  | "COMPLETED_EARLY"
  | "COMPLETED_DELAYED"
  | "PENDING_ON_TRACK"
  | "PENDING_DUE_SOON"
  | "DUE_TODAY"
  | "OVERDUE_PENDING"
  | "NOT_APPLICABLE";

export interface TaskComputed {
  status: TaskStatus;
  variance_days: number | null; // + = late/overdue, - = early, null = N/A
  rag: Rag;
}

export interface RagThresholds {
  amberMaxDays: number; // days of delay/overdue that stay Amber; beyond this -> Red
  dueSoonDays: number; // days before plan_date that trigger an early Amber warning
}

function toDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export function computeTask(
  planDate: string | null,
  actualDate: string | null,
  notApplicable: boolean,
  today: Date,
  thresholds: RagThresholds
): TaskComputed {
  if (notApplicable || !planDate) {
    return { status: "NOT_APPLICABLE", variance_days: null, rag: "N/A" };
  }

  const plan = toDate(planDate);

  if (actualDate) {
    const actual = toDate(actualDate);
    const variance = daysBetween(actual, plan);
    if (variance <= 0) {
      return {
        status: variance === 0 ? "COMPLETED_ON_TIME" : "COMPLETED_EARLY",
        variance_days: variance,
        rag: "GREEN",
      };
    }
    return {
      status: "COMPLETED_DELAYED",
      variance_days: variance,
      rag: variance <= thresholds.amberMaxDays ? "AMBER" : "RED",
    };
  }

  const overdue = daysBetween(today, plan); // + = past due, - = days remaining
  if (overdue > 0) {
    return {
      status: "OVERDUE_PENDING",
      variance_days: overdue,
      rag: overdue <= thresholds.amberMaxDays ? "AMBER" : "RED",
    };
  }
  if (overdue === 0) {
    return { status: "DUE_TODAY", variance_days: 0, rag: "AMBER" };
  }
  const daysRemaining = -overdue;
  return {
    status: daysRemaining <= thresholds.dueSoonDays ? "PENDING_DUE_SOON" : "PENDING_ON_TRACK",
    variance_days: null,
    rag: daysRemaining <= thresholds.dueSoonDays ? "AMBER" : "GREEN",
  };
}

/**
 * Escalation tier per Part F, Section 8.3. `isPostFinalInspection` should be
 * true for any task_template tagged to a stage at/after "QC GATE 4" (Final
 * Inspection) — those escalate immediately regardless of day-count.
 */
export function computeEscalationTier(
  variance_days: number | null,
  isPostFinalInspection: boolean,
  thresholds: RagThresholds
): 0 | 1 | 2 | 3 | 4 {
  if (isPostFinalInspection && variance_days !== null && variance_days > 0) return 4;
  if (variance_days === null || variance_days <= 0) return 0;
  if (variance_days <= thresholds.amberMaxDays) return 1;
  if (variance_days <= 7) return 2;
  return 3;
}

export function thresholdsFromEnv(env: { AMBER_MAX_DAYS: string; DUE_SOON_DAYS: string }): RagThresholds {
  return {
    amberMaxDays: parseInt(env.AMBER_MAX_DAYS, 10) || 3,
    dueSoonDays: parseInt(env.DUE_SOON_DAYS, 10) || 3,
  };
}
