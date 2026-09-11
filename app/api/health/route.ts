// Priority 3 (docs/production-readiness.md): "Health endpoint." Public
// and unauthenticated by design — this is what an uptime monitor hits,
// not an operator dashboard (see /api/admin/cron-runs for that, which IS
// authenticated). Deliberately minimal: proves the Worker is running and
// D1 is reachable, nothing about deal/user data or internals.
import { getDb } from "../../../db";
import { users } from "../../../db/schema";

export async function GET() {
  let database: "ok" | "error" = "ok";
  try {
    await getDb().select({ id: users.id }).from(users).limit(1);
  } catch {
    database = "error";
  }

  const status = database === "ok" ? "ok" : "degraded";
  return Response.json(
    { status, timestamp: new Date().toISOString(), checks: { database } },
    { status: status === "ok" ? 200 : 503 },
  );
}
