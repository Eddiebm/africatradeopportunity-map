// Launch-prep follow-up (docs/DEPLOYMENT.md / docs/production-readiness.md):
// "no automated backup Cron Trigger" — proves a real snapshot is actually
// written to R2 with real row data in it (not an empty/fabricated
// placeholder), and that retention pruning genuinely deletes what's past
// the window and genuinely keeps what isn't.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getDb } from "../../db";
import { users } from "../../db/schema";
import { BACKUP_RETENTION_DAYS, pruneOldBackups, runBackupAndPrune, runFullBackup } from "../../lib/data-backup";

async function clearBackups() {
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: "backups/", cursor });
    for (const object of page.objects) await env.BUCKET.delete(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

describe("lib/data-backup", () => {
  beforeEach(async () => {
    await clearBackups();
    await getDb().delete(users);
  });

  it("writes a real snapshot to R2 containing an actually-inserted row, not an empty placeholder", async () => {
    const db = getDb();
    await db.insert(users).values({ email: "backuptest@example.com", passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Backup Test" });

    const result = await runFullBackup();
    expect(result.key.startsWith("backups/")).toBe(true);
    expect(result.tableCounts.users).toBeGreaterThanOrEqual(1);
    expect(result.totalRows).toBeGreaterThanOrEqual(1);

    const object = await env.BUCKET.get(result.key);
    expect(object).not.toBeNull();
    const parsed = (await object!.json()) as { takenAt: string; tables: Record<string, { email?: string }[]> };
    expect(parsed.takenAt).toBeTruthy();
    expect(parsed.tables.users.some((u) => u.email === "backuptest@example.com")).toBe(true);
  });

  it("discovers tables dynamically — includes a table that isn't hand-listed anywhere in this test", async () => {
    // Proves allTables() isn't a stale hardcoded list — securityEvents is
    // never referenced by name in lib/data-backup.ts itself.
    const result = await runFullBackup();
    expect(Object.keys(result.tableCounts)).toContain("security_events");
    expect(Object.keys(result.tableCounts)).toContain("account_deletion_requests");
  });

  it("pruneOldBackups keeps a just-taken backup when checked at the real current time", async () => {
    const result = await runFullBackup();
    const prune = await pruneOldBackups(new Date());
    expect(prune.deleted).toBe(0);
    expect(prune.kept).toBeGreaterThanOrEqual(1);
    expect(await env.BUCKET.get(result.key)).not.toBeNull();
  });

  it("pruneOldBackups deletes a backup once it's past the retention window", async () => {
    const result = await runFullBackup();
    // Simulate time having moved well past the retention window, rather
    // than needing to actually wait real days for R2's own `uploaded`
    // timestamp to age — the object's real upload time stays fixed; only
    // the reference point pruneOldBackups compares it against moves.
    const wellPastWindow = new Date(Date.now() + (BACKUP_RETENTION_DAYS + 5) * 86_400_000);
    const prune = await pruneOldBackups(wellPastWindow);
    expect(prune.deleted).toBeGreaterThanOrEqual(1);
    expect(await env.BUCKET.get(result.key)).toBeNull();
  });

  it("runBackupAndPrune does both in one call", async () => {
    const result = await runBackupAndPrune();
    expect(result.key.startsWith("backups/")).toBe(true);
    expect(typeof result.deleted).toBe("number");
    expect(typeof result.kept).toBe("number");
  });
});
