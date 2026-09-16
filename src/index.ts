import { Hono } from "hono";
import type { Env, Variables } from "./lib/types";
import { requireAuth } from "./lib/auth";
import departments from "./routes/departments";
import users from "./routes/users";
import projects from "./routes/projects";
import tasks from "./routes/tasks";
import paymentMilestones from "./routes/paymentMilestones";
import dashboard from "./routes/dashboard";
import frameworks from "./routes/frameworks";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Unauthenticated health check — useful for Cloudflare Access "bypass"
// rules and uptime monitoring.
app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// Everything else under /api requires an authenticated, provisioned user.
app.use("/api/*", requireAuth);

app.get("/api/me", (c) => c.json(c.get("user")));

app.route("/api/departments", departments);
app.route("/api/users", users);
app.route("/api/projects", projects);
app.route("/api/tasks", tasks);
app.route("/api/payment-milestones", paymentMilestones);
app.route("/api/dashboard", dashboard);
app.route("/api/frameworks", frameworks);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error", detail: err.message }, 500);
});

export default app;
