export interface Me {
  id: number;
  org_id: number;
  email: string;
  name: string;
  department_id: number | null;
  role: "superadmin" | "dept_head" | "member" | "project_owner";
  active: number;
}

export interface Department {
  id: number;
  name: string;
}

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  active: number;
  department_id: number | null;
  department_name: string | null;
}

export interface ProjectRow {
  id: number;
  name: string;
  client: string | null;
  contract_value: number | null;
  balance_value: number | null;
  po_date: string | null;
  status: string;
  rag_summary: { green: number; amber: number; red: number; na: number; total: number };
  overall_rag: "GREEN" | "AMBER" | "RED";
}

export interface TaskRow {
  project_task_id: number;
  project_id: number;
  project_name: string;
  task_template_id: number;
  task_seq: number;
  task_code: string;
  task_name: string;
  is_conditional: number;
  stage_id: number | null;
  stage_name: string | null;
  stage_phase: string | null;
  owner_department_id: number | null;
  owner_department_name: string | null;
  owner_user_id: number | null;
  owner_user_name: string | null;
  plan_date: string | null;
  actual_date: string | null;
  not_applicable: number;
  status: string;
  variance_days: number | null;
  rag: "GREEN" | "AMBER" | "RED" | "N/A";
  escalation_tier: number;
  open_delay: { reason: string; proposed_action: string; target_date: string | null } | null;
}

export interface PortfolioSummary {
  total_activities: number;
  applicable_activities: number;
  percent_delivered: number;
  overdue_no_actual: number;
  rag: { green: number; amber: number; red: number; na: number; total: number };
  projects_total: number;
  projects_red: number;
  projects_amber: number;
  projects_green: number;
  value_at_risk: number;
}

const DEV_EMAIL_KEY = "strucrite_dev_email";

function devHeaders(): Record<string, string> {
  const email = localStorage.getItem(DEV_EMAIL_KEY);
  return email ? { "X-Dev-User-Email": email } : {};
}

export function setDevEmail(email: string) {
  localStorage.setItem(DEV_EMAIL_KEY, email);
}
export function getDevEmail(): string | null {
  return localStorage.getItem(DEV_EMAIL_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...devHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((body as any).error ?? `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export const api = {
  me: () => request<Me>("/me"),
  departments: () => request<Department[]>("/departments"),
  createDepartment: (name: string) => request("/departments", { method: "POST", body: JSON.stringify({ name }) }),
  users: () => request<UserRow[]>("/users"),
  createUser: (u: { email: string; name: string; department_id: number; role: string }) =>
    request("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id: number, patch: Partial<UserRow>) =>
    request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  projects: () => request<ProjectRow[]>("/projects"),
  createProject: (p: { name: string; client?: string; contract_value?: number; balance_value?: number; po_date?: string }) =>
    request("/projects", { method: "POST", body: JSON.stringify(p) }),
  tasksForProject: (projectId: number) => request<TaskRow[]>(`/tasks/project/${projectId}`),
  myTasks: () => request<TaskRow[]>("/tasks/mine"),
  assignTask: (id: number, patch: { owner_user_id?: number; plan_date?: string; not_applicable?: boolean }) =>
    request(`/tasks/${id}/assign`, { method: "PATCH", body: JSON.stringify(patch) }),
  updateTask: (id: number, patch: { actual_date: string; reason?: string; proposed_action?: string; target_date?: string }) =>
    request(`/tasks/${id}/update`, { method: "PATCH", body: JSON.stringify(patch) }),
  closeDelay: (id: number) => request(`/tasks/delay-log/${id}/close`, { method: "PATCH" }),
  paymentMilestones: (projectId: number) => request<any[]>(`/payment-milestones/project/${projectId}`),
  updatePaymentMilestone: (id: number, patch: any) =>
    request(`/payment-milestones/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  dashboardPortfolio: () => request<PortfolioSummary>("/dashboard/portfolio"),
  dashboardDepartments: () => request<any[]>("/dashboard/departments"),
  dashboardMembers: () => request<any[]>("/dashboard/members"),
  dashboardStageFunnel: () => request<any[]>("/dashboard/stage-funnel"),
  dashboardPaymentAging: () => request<any>("/dashboard/payment-aging"),
  dashboardDigest: () => request<any>("/dashboard/digest"),
  stages: () => request<any[]>("/frameworks/stages"),
  taskTemplates: () => request<any[]>("/frameworks/tasks"),
};
