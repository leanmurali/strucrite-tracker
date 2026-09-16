export type Role = "superadmin" | "dept_head" | "member" | "project_owner";

export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  ASSETS: Fetcher;
  AMBER_MAX_DAYS: string;
  DUE_SOON_DAYS: string;
  ENVIRONMENT: string;
}

export interface AppUser {
  id: number;
  org_id: number;
  email: string;
  name: string;
  department_id: number | null;
  role: Role;
  active: number;
}

export interface Variables {
  user: AppUser;
}
