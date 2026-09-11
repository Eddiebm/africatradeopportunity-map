// Priority 3 (docs/production-readiness.md): persists every Cron Trigger
// run to db/schema.ts's cronRuns table — see that table's header comment
// for why. Wraps the job's own async work so both success and failure are
// always recorded, with real start/finish timestamps and (on failure) the
// error message — never a stack trace with file paths in a table that
// might get surfaced in an admin UI later.
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { cronRuns } from "../db/schema";

// refreshedCount/failedCount only mean something for jobs whose result
// actually reports those two counts (currently just
// intelligence-watchlist-refresh) — generalized here (Priority 8, adding
// exception-queue-sync as a second job) rather than forcing every future
// job's result to fit that one shape. A job whose result doesn't have
// numeric `refreshed`/`failed` fields just gets null in those columns; its
// real counts still reach the caller's own return value and console.log,
// same as before this generalization.
function extractCounts(result: unknown): { refreshedCount: number | null; failedCount: number | null } {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    return {
      refreshedCount: typeof r.refreshed === "number" ? r.refreshed : null,
      failedCount: typeof r.failed === "number" ? r.failed : null,
    };
  }
  return { refreshedCount: null, failedCount: null };
}

export async function recordCronRun<T>(jobName: string, run: () => Promise<T>): Promise<T> {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const [row] = await db.insert(cronRuns).values({ jobName, startedAt, status: "running" }).returning({ id: cronRuns.id });

  try {
    const result = await run();
    const { refreshedCount, failedCount } = extractCounts(result);
    await db
      .update(cronRuns)
      .set({
        finishedAt: new Date().toISOString(),
        status: "success",
        refreshedCount,
        failedCount,
      })
      .where(eq(cronRuns.id, row.id));
    return result;
  } catch (error) {
    await db
      .update(cronRuns)
      .set({
        finishedAt: new Date().toISOString(),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(cronRuns.id, row.id));
    throw error;
  }
}
