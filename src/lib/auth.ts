import type { Context, Next } from "hono";
import type { Env, Variables } from "./types";

/**
 * Identity comes from Cloudflare Access, which must be configured to front
 * this Worker's hostname (strucrite.valueenablers.com) with Google as the
 * identity provider — see README "Cloudflare Access setup". Access blocks
 * any request that isn't authenticated *before* it reaches this Worker, and
 * forwards the verified email in `Cf-Access-Authenticated-User-Email`.
 *
 * Hardening note: for defense-in-depth beyond trusting that header (e.g. if
 * this Worker is ever exposed on a route Access doesn't cover), verify the
 * `Cf-Access-Jwt-Assertion` JWT's signature against your team's JWKS
 * (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs) and check the
 * `aud` claim before trusting it. Not done here to keep the MVP dependency
 * footprint small; flagged in the README as a pre-production hardening step.
 */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const email = c.req.header("Cf-Access-Authenticated-User-Email");
  if (!email) {
    // Only reachable in local dev (wrangler dev) where Access isn't in
    // front of the Worker. Fall back to a dev header so `npm run dev`
    // works without deploying Access first.
    const devEmail = c.req.header("X-Dev-User-Email");
    if (c.env.ENVIRONMENT !== "production" && devEmail) {
      return authenticateByEmail(c, next, devEmail);
    }
    return c.json({ error: "Not authenticated (missing Cloudflare Access identity)" }, 401);
  }
  return authenticateByEmail(c, next, email);
}

async function authenticateByEmail(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
  email: string
) {
  const user = await c.env.DB.prepare(
    "SELECT id, org_id, email, name, department_id, role, active FROM user WHERE email = ?"
  )
    .bind(email.toLowerCase())
    .first();

  if (!user) {
    return c.json(
      { error: `No account provisioned for ${email}. Ask a Superadmin to add you as a user first.` },
      403
    );
  }
  if (!user.active) {
    return c.json({ error: "This account has been deactivated." }, 403);
  }

  c.set("user", user as any);
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) {
      return c.json({ error: `This action requires one of: ${roles.join(", ")}` }, 403);
    }
    await next();
  };
}
