// Priority 3 (docs/production-readiness.md): "Cron-run history" +
// "Cron failure visibility" — administrator-only (this can include an
// error message, which /api/health deliberately never exposes publicly).
import { desc } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { getDb } from "../../../../db";
import { cronRuns } from "../../../../db/schema";

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, ["administrator"]);
  if (auth instanceof Response) return auth;

  const rows = await getDb().select().from(cronRuns).orderBy(desc(cronRuns.id)).limit(50);
  return Response.json({ runs: rows });
}
