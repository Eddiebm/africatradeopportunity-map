// Priority 3 (docs/production-readiness.md): "Cron-run history" +
// "Cron failure visibility." Proves recordCronRun actually persists both
// outcomes against a real D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { cronRuns } from "../../db/schema";
import { recordCronRun } from "../../lib/cron-runs";

describe("lib/cron-runs recordCronRun", () => {
  beforeEach(async () => {
    await getDb().delete(cronRuns);
  });

  it("records a successful run with counts and a finish time", async () => {
    const result = await recordCronRun("test-job", async () => ({ refreshed: 3, failed: 1 }));
    expect(result).toEqual({ refreshed: 3, failed: 1 });

    const [row] = await getDb().select().from(cronRuns);
    expect(row.jobName).toBe("test-job");
    expect(row.status).toBe("success");
    expect(row.refreshedCount).toBe(3);
    expect(row.failedCount).toBe(1);
    expect(row.finishedAt).not.toBeNull();
    expect(row.errorMessage).toBeNull();
  });

  it("records a failed run with the error message, and re-throws so the caller still sees the failure", async () => {
    await expect(
      recordCronRun("test-job-failing", async () => {
        throw new Error("simulated upstream outage");
      }),
    ).rejects.toThrow("simulated upstream outage");

    const [row] = await getDb().select().from(cronRuns);
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toBe("simulated upstream outage");
    expect(row.finishedAt).not.toBeNull();
    expect(row.refreshedCount).toBeNull();
  });

  it("a row exists in 'running' state the moment the job starts, even before it finishes", async () => {
    let sawRunningRow = false;
    await recordCronRun("test-job-mid-flight", async () => {
      const rows = await getDb().select().from(cronRuns);
      sawRunningRow = rows.some((r) => r.status === "running");
      return { refreshed: 0, failed: 0 };
    });
    expect(sawRunningRow).toBe(true); // proves a crashed/timed-out run is still visible as "running", not silently absent
  });
});
