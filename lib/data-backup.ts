// Launch-prep follow-up (docs/production-readiness.md / docs/DEPLOYMENT.md):
// "no automated backup Cron Trigger" was flagged as an explicit, repeated
// remaining risk since Priority 3. This is that job.
//
// What this is NOT: a `wrangler d1 export`-equivalent SQL dump — Workers'
// D1 binding has no API surface for that (no `.dump()`), and D1 export is
// a CLI/dashboard-only operation. docs/DEPLOYMENT.md's manual
// `wrangler d1 export --remote` step (run before any destructive
// migration) remains the real SQL-level backup path and is NOT replaced
// by this.
//
// What this IS: a real, automated, application-level snapshot — every row
// of every table in db/schema.ts, serialized to one JSON object, uploaded
// to the SAME R2 bucket this app already uses for documents (no new
// resource to provision), under a dated `backups/` key. It runs
// unattended, on a schedule, which the manual CLI step by definition
// cannot — this is what makes "was a backup actually taken last night" a
// query (via cronRuns, like every other scheduled job here) instead of a
// hope that someone remembered to run the CLI command. Restoring from one
// means writing each table's rows back via INSERT statements built from
// this JSON — slower than replaying a SQL dump, but real and complete.
//
// The table list is discovered from db/schema.ts at call time (every
// exported SQLiteTable), not hand-maintained — a new table added to the
// schema is backed up automatically the next time this runs, with nothing
// to remember to update here.
import { is, getTableName } from "drizzle-orm";
import { SQLiteTable, type AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import * as schema from "../db/schema";

// Purely an operational choice about how much disaster-recovery history to
// keep in R2 — NOT the audit-log retention decision (that's
// lib/audit-retention.ts's separate, account-owner-confirmed 3-year
// window, which governs deleting real user-facing log rows, not backup
// housekeeping). 30 daily snapshots is a common, sensible default;
// changing it is a one-line edit, not a data-model change.
export const BACKUP_RETENTION_DAYS = 30;

// AnySQLiteTable (not a specific per-table union) deliberately: db/schema.ts
// exports 50+ distinctly-typed tables, and narrowing to their exact union
// breaks the type predicate (a column-shape mismatch across tables) —
// every row of this backup is serialized straight to JSON regardless of
// shape, so nothing downstream needs per-table column types.
function allTables(): AnySQLiteTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is AnySQLiteTable => is(value, SQLiteTable));
}

export interface BackupResult {
  key: string;
  tableCounts: Record<string, number>;
  totalRows: number;
}

export async function runFullBackup(now: Date = new Date()): Promise<BackupResult> {
  const db = getDb();
  const tables = allTables();
  const snapshot: Record<string, unknown[]> = {};
  let totalRows = 0;

  for (const table of tables) {
    const name = getTableName(table);
    const rows = await db.select().from(table);
    snapshot[name] = rows;
    totalRows += rows.length;
  }

  const key = `backups/${now.toISOString().replace(/[:.]/g, "-")}.json`;
  await env.BUCKET.put(key, JSON.stringify({ takenAt: now.toISOString(), tables: snapshot }), {
    httpMetadata: { contentType: "application/json" },
  });

  const tableCounts = Object.fromEntries(Object.entries(snapshot).map(([tableName, rows]) => [tableName, rows.length]));
  return { key, tableCounts, totalRows };
}

export interface BackupPruneResult {
  deleted: number;
  kept: number;
}

/** Deletes backups older than BACKUP_RETENTION_DAYS. Paginates through
 * every object under the "backups/" prefix rather than assuming the list
 * stays under R2's single-page limit forever. */
export async function pruneOldBackups(now: Date = new Date()): Promise<BackupPruneResult> {
  const cutoffMs = now.getTime() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  let deleted = 0;
  let kept = 0;

  do {
    const page = await env.BUCKET.list({ prefix: "backups/", cursor });
    for (const object of page.objects) {
      if (object.uploaded.getTime() < cutoffMs) {
        await env.BUCKET.delete(object.key);
        deleted += 1;
      } else {
        kept += 1;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { deleted, kept };
}

/** The actual Cron Trigger entry point (worker/index.ts) — take a fresh
 * snapshot, then prune anything past the retention window. Combined into
 * one job/one cronRuns row since they're the same operational concern, not
 * two independent schedules. */
export async function runBackupAndPrune(now: Date = new Date()): Promise<BackupResult & BackupPruneResult> {
  const backup = await runFullBackup(now);
  const prune = await pruneOldBackups(now);
  return { ...backup, ...prune };
}
