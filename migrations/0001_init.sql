-- StrucRite Project Delivery Tracker — initial schema
-- Maps to Sep-11 Parts A-F (see /docs project doc "app-architecture-spec-16sep26.md").
-- SQLite dialect (Cloudflare D1).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Tenancy / people
-- ---------------------------------------------------------------------
CREATE TABLE organization (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE department (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organization(id),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, name)
);

-- role: 'superadmin' | 'dept_head' | 'member' | 'project_owner'
CREATE TABLE user (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organization(id),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  department_id   INTEGER REFERENCES department(id),
  role            TEXT NOT NULL CHECK (role IN ('superadmin','dept_head','member','project_owner')),
  phone_whatsapp  TEXT,                       -- E.164 format, for the Phase-2 WhatsApp channel
  active          INTEGER NOT NULL DEFAULT 1, -- 0 = deactivated, keeps history intact
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_department ON user(department_id);

-- ---------------------------------------------------------------------
-- Projects  (Part A — Master Project Register)
-- ---------------------------------------------------------------------
CREATE TABLE project (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organization(id),
  name             TEXT NOT NULL,
  client           TEXT,
  contract_value   REAL,               -- INR, incl. GST
  balance_value    REAL,               -- INR, remaining balance of work
  po_date          TEXT,               -- ISO date
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','closed')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A user can additionally act as Project Owner on specific projects
-- without being a full department head/superadmin.
CREATE TABLE project_owner_assignment (
  project_id  INTEGER NOT NULL REFERENCES project(id),
  user_id     INTEGER NOT NULL REFERENCES user(id),
  PRIMARY KEY (project_id, user_id)
);

-- ---------------------------------------------------------------------
-- Master frameworks  (Part B — 24-stage RDSO framework, reporting roll-up)
-- ---------------------------------------------------------------------
CREATE TABLE stage_template (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                INTEGER NOT NULL REFERENCES organization(id),
  phase                 TEXT NOT NULL,   -- Document Control | Production | Quality Gate | External / Client | Dispatch
  seq                   INTEGER NOT NULL,
  code                  TEXT NOT NULL,   -- e.g. "1", "QC GATE 1"
  name                  TEXT NOT NULL,
  key_activities         TEXT,
  owner_department_id    INTEGER REFERENCES department(id),
  deliverable_evidence  TEXT,
  UNIQUE(org_id, seq)
);

-- The canonical, per-activity task list (42 rows) — what a Member actually
-- updates day to day. Each row is tagged to one stage_template row so the
-- stage-funnel roll-up (Part B/C) works.
CREATE TABLE task_template (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                INTEGER NOT NULL REFERENCES organization(id),
  stage_template_id     INTEGER REFERENCES stage_template(id),
  seq                   INTEGER NOT NULL,
  code                  TEXT NOT NULL,     -- e.g. "2.1", "5.3" (matches the QC workbook's # column)
  name                  TEXT NOT NULL,
  owner_department_id   INTEGER REFERENCES department(id),
  plan_offset_days      INTEGER,           -- optional: default offset from a project's PO date, for auto-seeding plan_date
  plan_offset_ref_seq    INTEGER,           -- which prior task_template.seq the offset is relative to (NULL = PO date)
  is_conditional        INTEGER NOT NULL DEFAULT 0, -- 1 = "(IF REQ.)" style activity, may be marked N/A per project
  UNIQUE(org_id, seq)
);

-- ---------------------------------------------------------------------
-- Per-project tracker  (Part C)
-- ---------------------------------------------------------------------
CREATE TABLE project_task (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES project(id),
  task_template_id  INTEGER NOT NULL REFERENCES task_template(id),
  owner_user_id     INTEGER REFERENCES user(id),
  plan_date         TEXT,      -- ISO date; NULL = not yet scheduled
  actual_date       TEXT,      -- ISO date; NULL = not completed
  not_applicable    INTEGER NOT NULL DEFAULT 0,  -- 1 = "NOT REQUIRED"/"NA" for this project
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, task_template_id)
);
CREATE INDEX idx_project_task_project ON project_task(project_id);
CREATE INDEX idx_project_task_owner ON project_task(owner_user_id);

-- Append-only audit trail. status/rag are NEVER stored columns on
-- project_task — they're always computed server-side from plan/actual/today
-- (see src/lib/rag.ts) so they can never go stale. This table is what
-- restores "who changed what, when" that the spreadsheet never had.
CREATE TABLE task_update_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_task_id  INTEGER NOT NULL REFERENCES project_task(id),
  user_id          INTEGER REFERENCES user(id),
  channel          TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp','import','system')),
  field            TEXT NOT NULL,   -- 'plan_date' | 'actual_date' | 'owner_user_id' | 'not_applicable'
  old_value        TEXT,
  new_value        TEXT,
  changed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_update_log_task ON task_update_log(project_task_id);

-- ---------------------------------------------------------------------
-- Gap, Root-Cause & Action Log  (Part E)
-- ---------------------------------------------------------------------
CREATE TABLE delay_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_task_id    INTEGER NOT NULL REFERENCES project_task(id),
  reason             TEXT NOT NULL,
  root_cause_type    TEXT,   -- free-text category, e.g. "Procurement", "External Agency", "Production Capacity"
  proposed_action    TEXT NOT NULL,
  action_owner_id    INTEGER REFERENCES user(id),
  target_date        TEXT,
  opened_at          TEXT NOT NULL DEFAULT (datetime('now')),
  opened_by          INTEGER REFERENCES user(id),
  closed_at          TEXT,
  closed_by          INTEGER REFERENCES user(id)
);
CREATE INDEX idx_delay_log_task ON delay_log(project_task_id);
CREATE INDEX idx_delay_log_open ON delay_log(project_task_id, closed_at);

-- ---------------------------------------------------------------------
-- Payment Tracking Overlay  (Part D)
-- ---------------------------------------------------------------------
CREATE TABLE payment_milestone (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL REFERENCES project(id),
  payment_point         TEXT NOT NULL,   -- Advance / Progress / Pre-Dispatch / Final / Retention
  seq                   INTEGER NOT NULL,
  triggered_by_stage_id INTEGER REFERENCES stage_template(id),
  invoice_raised_date   TEXT,
  invoice_amount        REAL,
  payment_received_date TEXT,
  amount_received       REAL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invoiced','partially_paid','paid','overdue')),
  UNIQUE(project_id, seq)
);
CREATE INDEX idx_payment_milestone_project ON payment_milestone(project_id);

-- ---------------------------------------------------------------------
-- Escalation ladder  (Part F, Section 8.3)
-- tier: 1 = self-flag (0-3d, Amber) · 2 = Gap/Action Log + Weekly Review (4-7d, Red)
--       3 = Monthly Systemic Review (>7d) · 4 = immediate MD/Marketing/Accounts
--       (any delay after QC Gate 4 / Final Inspection, regardless of day count)
-- ---------------------------------------------------------------------
CREATE TABLE escalation_event (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_task_id   INTEGER NOT NULL REFERENCES project_task(id),
  tier              INTEGER NOT NULL CHECK (tier IN (1,2,3,4)),
  raised_at         TEXT NOT NULL DEFAULT (datetime('now')),
  notified_user_ids TEXT,   -- JSON array of user ids notified
  resolved_at       TEXT
);
CREATE INDEX idx_escalation_event_task ON escalation_event(project_task_id);

-- ---------------------------------------------------------------------
-- Convenience view: latest state per project_task, joined with template +
-- owner info. RAG/status/days_overdue are computed in application code
-- (src/lib/rag.ts) so the exact same logic runs whether the caller is the
-- API, a scheduled Worker, or a report — this view intentionally stops
-- short of that so there's one source of truth for the formula.
-- ---------------------------------------------------------------------
CREATE VIEW v_project_task_detail AS
SELECT
  pt.id                AS project_task_id,
  pt.project_id,
  p.name               AS project_name,
  tt.id                AS task_template_id,
  tt.seq               AS task_seq,
  tt.code              AS task_code,
  tt.name              AS task_name,
  tt.is_conditional,
  st.id                AS stage_id,
  st.name              AS stage_name,
  st.phase             AS stage_phase,
  d.id                 AS owner_department_id,
  d.name               AS owner_department_name,
  pt.owner_user_id,
  u.name               AS owner_user_name,
  pt.plan_date,
  pt.actual_date,
  pt.not_applicable,
  pt.updated_at
FROM project_task pt
JOIN task_template tt ON tt.id = pt.task_template_id
LEFT JOIN stage_template st ON st.id = tt.stage_template_id
LEFT JOIN department d ON d.id = tt.owner_department_id
LEFT JOIN user u ON u.id = pt.owner_user_id
JOIN project p ON p.id = pt.project_id;
