import { desc, eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { syncExceptionQueue } from "../../../../lib/exceptions";
import { getDb } from "../../../../db";
import { adminAuditEvents, exceptions } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

// Priority 8 (docs/production-readiness.md): "The standard operational path
// should not require manually monitoring every deal; staff attention
// should focus on exceptions." This is that focused view — every open
// item in one place, risk- and deadline-ranked, instead of a reviewer
// having to page through every deal/dispute/document tab looking for
// trouble. syncExceptionQueue() runs on every GET (in addition to the Cron
// Trigger in worker/index.ts) so this is never more than one request stale
// — see that function's own header for why re-running it is always safe.
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;

  const sync = await syncExceptionQueue();
  const rows = await getDb().select().from(exceptions).orderBy(desc(exceptions.detectedAt)).limit(500);

  // Risk/deadline ranking: severity first, then the nearest real deadline,
  // then oldest-detected first. Rows with no deadline sort after rows that
  // have one — a queue this platform can act on needs the "this is due
  // soonest" items visible before the undated ones, not scattered by id.
  const ranked = [...rows].sort((a, b) => {
    const statusRank = (s: string) => (s === "open" ? 0 : s === "in_progress" ? 1 : s === "dismissed" ? 2 : 3);
    if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
    const sevDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0;
  });

  return Response.json({ exceptions: ranked, sync });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  let body: { id?: number; action?: string; ownerEmail?: string; resolutionSummary?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = Number(body.id);
  const action = String(body.action || "");
  const reason = String(body.reason || "").trim();
  if (!id) return Response.json({ error: "Not found." }, { status: 404 });
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });
  if (!["assign", "start", "resolve", "dismiss"].includes(action)) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db.select().from(exceptions).where(eq(exceptions.id, id)).limit(1);
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });
  if (row.status === "resolved") {
    return Response.json({ error: "This exception is already resolved." }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (action === "assign") {
    const ownerEmail = String(body.ownerEmail || "").trim();
    if (!ownerEmail) return Response.json({ error: "An owner email is required to assign this exception." }, { status: 400 });
    const nextStatus = row.status === "open" ? "in_progress" : row.status;
    await db.update(exceptions).set({ ownerEmail, status: nextStatus, updatedAt: now }).where(eq(exceptions.id, id));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "exception_assigned", entityType: "exception", entityId: id, fromStatus: row.status, toStatus: nextStatus, reason: `Assigned to ${ownerEmail}. ${reason}` });
    return Response.json({ ok: true });
  }

  if (action === "start") {
    await db.update(exceptions).set({ status: "in_progress", updatedAt: now }).where(eq(exceptions.id, id));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "exception_started", entityType: "exception", entityId: id, fromStatus: row.status, toStatus: "in_progress", reason });
    return Response.json({ ok: true });
  }

  const resolutionSummary = String(body.resolutionSummary || "").trim();
  if (!resolutionSummary) return Response.json({ error: "A resolution summary is required." }, { status: 400 });

  if (action === "resolve") {
    // Resolving frees the dedupe key — a legitimate recurrence of the same
    // condition later gets a fresh row (see db/schema.ts's exceptions
    // header for why this is the correct behavior, not a bug).
    await db.update(exceptions).set({ status: "resolved", resolvedAt: now, resolvedByEmail: admin.email, resolutionSummary, openDedupeKey: null, updatedAt: now }).where(eq(exceptions.id, id));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "exception_resolved", entityType: "exception", entityId: id, fromStatus: row.status, toStatus: "resolved", reason: resolutionSummary });
    return Response.json({ ok: true });
  }

  // dismiss — deliberately keeps openDedupeKey set so the very next sync
  // doesn't immediately recreate a duplicate row for a condition a
  // reviewer already looked at and decided not to act on (see db/schema.ts).
  await db.update(exceptions).set({ status: "dismissed", resolvedAt: now, resolvedByEmail: admin.email, resolutionSummary, updatedAt: now }).where(eq(exceptions.id, id));
  await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "exception_dismissed", entityType: "exception", entityId: id, fromStatus: row.status, toStatus: "dismissed", reason: resolutionSummary });
  return Response.json({ ok: true });
}
