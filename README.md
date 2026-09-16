# StrucRite Project Delivery Tracker

A multi-user, role-based rebuild of the StrucRite QC tracker spreadsheet, built to deploy at
**strucrite.valueenablers.com** on Cloudflare (Workers + D1 + Access), so every department can
update its own tasks instead of one person reconstructing everyone's status after the fact.

This is the "v2" promised in the Sep-11-2026 design doc's own roadmap. It implements Parts A–F
of that doc:

| Part | What it is | Where it lives here |
|---|---|---|
| A | Master Project Register | `Projects` page + `project` table |
| B | 24-stage RDSO master framework | `stage_template` table, seeded; read-only reference data |
| C | Per-project 42-activity tracker | `ProjectDetail` page + `project_task` table |
| D | Payment Tracking Overlay | `payment_milestone` table + `/api/payment-milestones` |
| E | Gap, Root-Cause & Action Log | `delay_log` table — created automatically whenever a task is marked done later than its plan date |
| F | Escalation ladder + review cadence | `computeEscalationTier()` in `src/lib/rag.ts`, `/api/dashboard/digest` |

Full background and decisions: see the project's `app-architecture-spec-16sep26.md` doc.

## What's built vs. what's next

**Built and tested locally end-to-end** (schema, seed data, and every API route below were run
against a local D1 instance during development — see "How this was tested" at the bottom):
Cloudflare Access auth wiring, role-based permissions (Superadmin / Department Head / Member),
project + task CRUD, the mandatory reason-for-delay rule, live-computed STATUS/VARIANCE/RAG on
the real escalation-ladder thresholds, the Portfolio/Department/Member/Stage-funnel/Payment-aging
dashboard views, and a working React frontend for all of it.

**Not yet built** (see the architecture spec's phasing, §9): scheduled email notifications when a
task crosses an escalation tier, the WhatsApp update channel (needs a WhatsApp Business API
account — not available yet), file attachments (R2 is wired up but nothing uses it yet), and the
`project_owner` cross-department role (the `role` exists in the schema but no screen uses it yet).

## Prerequisites

- Node.js 18+ and npm
- A Cloudflare account with Workers + D1 enabled (your account already has both, from the
  `scalexpress-app` project)
- `npm install -g wrangler` (v4), then `wrangler login`

## Local development

```bash
npm install
npm --prefix web install

# one-time: create the local D1 database and load schema + seed data
npm run db:migrate:local
npm run db:seed:local

# run the API (terminal 1)
npm run dev

# run the frontend with hot reload (terminal 2)
npm --prefix web run dev
# open http://localhost:5173 — it proxies /api to the Worker on :8787
```

There's no login screen in local dev — Cloudflare Access isn't in front of `wrangler dev`. The
app falls back to a one-field "dev sign-in" box (any email already seeded in the `user` table;
the seed data provisions `murali@valueenablers.com` as Superadmin). This box **never appears in
production** — see "Cloudflare Access setup" below.

## Deploying

### 1. Create the real Cloudflare resources

```bash
wrangler d1 create strucrite-tracker
# copy the returned database_id into wrangler.toml's [[d1_databases]] block

wrangler r2 bucket create strucrite-tracker-evidence

wrangler d1 execute strucrite-tracker --remote --file=./migrations/0001_init.sql
wrangler d1 execute strucrite-tracker --remote --file=./seed/seed.sql
```

### 2. Push to GitHub and connect Cloudflare

```bash
git init -b main   # if not already a repo
git add -A
git commit -m "Initial StrucRite tracker build"
git remote add origin https://github.com/<your-org>/strucrite-tracker.git
git push -u origin main
```

Then in the Cloudflare dashboard: **Workers & Pages → Create → Workers → Import a repository**,
pick this repo, and set the build command to `npm run build:web` with the deploy command
`npx wrangler deploy` (or just let Cloudflare's Git integration run `npm run deploy`, which does
both). Every push to `main` redeploys automatically from then on — no local Wrangler CLI needed
after this first connection.

If you'd rather deploy from your own machine instead of Git integration: `npm run deploy`.

### 3. Custom domain

Workers & Pages → `strucrite-tracker-api` → Settings → Domains & Routes → Add
`strucrite.valueenablers.com` (valueenablers.com must already be on Cloudflare DNS).

### 4. Cloudflare Access setup (Google Workspace SSO)

This is what makes login "just works with your Google account" instead of a password form:

1. Zero Trust dashboard → **Access → Applications → Add an application → Self-hosted**.
2. Domain: `strucrite.valueenablers.com`.
3. Identity providers: add **Google** (or Google Workspace, restricted to your domain) if not
   already configured for your Cloudflare account.
4. Policy: allow rule for your Google Workspace domain (e.g. `@valueenablers.com`, and
   `@strucrite...` if StrucRite staff use a different Workspace domain — add both as an "OR" rule,
   or add specific emails).
5. Save. From then on, every request to the domain requires a Google sign-in before it ever
   reaches the Worker, and the Worker reads the verified email from the
   `Cf-Access-Authenticated-User-Email` header (see `src/lib/auth.ts`).

**Important:** signing in through Access only proves *who* someone is — it does not create their
app account. A Superadmin still has to add them once via **Admin → Users** (or they'll see "No
account provisioned for you" on first login). This is intentional: it's the same
"Superadmin: Add members" requirement from the original spec.

### 5. Hardening before wider rollout

`src/lib/auth.ts` currently trusts the `Cf-Access-Authenticated-User-Email` header, which is safe
as long as Access fronts every route on this hostname (the default). For defense-in-depth, verify
the `Cf-Access-Jwt-Assertion` JWT's signature against your team's JWKS
(`https://<your-team>.cloudflareaccess.com/cdn-cgi/access/certs`) before trusting it — see the
comment in that file for exactly where to add it.

## Escalation ladder reference (Part F, §8.3)

Hardcoded in `src/lib/rag.ts` / `AMBER_MAX_DAYS` / `DUE_SOON_DAYS` in `wrangler.toml`:

- **0–3 days late/overdue → Amber.** Owning department self-flags it, gives a revised date same
  day, no meeting needed.
- **4–7 days → Red.** Mandatory `delay_log` (Part E) entry — the app enforces this automatically
  when a Member marks a task done late.
- **More than 7 days → still Red, escalation tier 3** (Monthly Systemic Review, MD-led) — see
  `escalation_tier` on every task in the API response.
- **Any delay after QC Gate 4 / Final Inspection → escalation tier 4**, immediate, regardless of
  day-count — the order is inspection-passed and every day is idle cash.

Tiers 3 and 4 are computed but not yet wired to a notification — that's the "scheduled email
notifications" item under "what's next" above.

## How this was tested

Everything in this repo was actually run, not just written, before delivery: the schema was
loaded into a local D1 instance, the 42-activity/16-project seed data was generated from the real
Sep-16-2026 QC workbook and loaded successfully, `wrangler dev` was started against that data, and
every API route (auth, RBAC denial, project listing with computed RAG, the mandatory-delay-reason
rule, dashboard aggregations, payment milestones) was exercised with `curl` and returned correct
results — including a portfolio value-at-risk figure (₹67.6 Cr) that lines up with the manual
Sep-16 analysis. The frontend was type-checked and built to a production bundle, and that bundle
was confirmed to be served correctly by the same Worker alongside the API (single-deploy
"Workers with static assets" pattern, `run_worker_first: ["/api/*"]` in `wrangler.toml`). What
was **not** possible in this environment: a real deploy to your Cloudflare account (this session
can create D1/R2 resources but has no credential to push Worker code — see the architecture spec
§10), and an interactive Cloudflare Access login (Access isn't running locally).
