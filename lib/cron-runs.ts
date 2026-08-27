// Priority 3 (docs/production-readiness.md): persists every Cron Trigger
// run to db/schema.ts's cronRuns table — see that table's header comment
// for why. Wraps the job's own async work so both success and failure are
// always recorded, with real start/finish timestamps and (on failure) the
// error message — never a stack trace with file paths in a table that
// might get surfaced in an admin UI later.
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { cronRuns } from "../db/schema";

export async function recordCronRun<T extends { refreshed: number; failed: number }>(
  jobName: string,
  run: () => Promise<T>,
): Promise<T> {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const [row] = await db.insert(cronRuns).values({ jobName, startedAt, status: "running" }).returning({ id: cronRuns.id });

  try {
    const result = await run();
    await db
      .update(cronRuns)
      .set({
        finishedAt: new Date().toISOString(),
        status: "success",
        refreshedCount: result.refreshed,
        failedCount: result.failed,
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
