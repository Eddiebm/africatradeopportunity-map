import { desc, eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { decideHeldAccountDeletion } from "../../../../lib/account-deletion";
import { getDb } from "../../../../db";
import { accountDeletionRequests, users } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

// Admin half of account deletion — see lib/account-deletion.ts's header
// comment. GET returns every request that ever needed a human look (held,
// plus their eventual decision) so a reviewer can see outcomes, not just
// the current queue; the client filters to "awaiting review" for the
// active work list, same pattern as app/admin/page.tsx's exceptions tab.
export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;

  const db = getDb();
  const rows = await db
    .select({ request: accountDeletionRequests, userEmail: users.email, userDisplayName: users.displayName })
    .from(accountDeletionRequests)
    .innerJoin(users, eq(accountDeletionRequests.userId, users.id))
    .where(eq(accountDeletionRequests.status, "held_for_review"))
    .orderBy(desc(accountDeletionRequests.id))
    .limit(200);

  return Response.json({
    requests: rows.map((r) => ({ ...r.request, userEmail: r.userEmail, userDisplayName: r.userDisplayName })),
  });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  let body: { id?: number; decision?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = Number(body.id);
  const decision = String(body.decision || "");
  const reason = String(body.reason || "").trim();
  if (!id) return Response.json({ error: "Not found." }, { status: 404 });
  if (decision !== "approved" && decision !== "denied") return Response.json({ error: "decision must be approved or denied." }, { status: 400 });
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });

  const result = await decideHeldAccountDeletion(id, { id: admin.id, email: admin.email }, decision, reason);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
