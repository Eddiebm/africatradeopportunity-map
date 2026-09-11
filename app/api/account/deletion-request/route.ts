import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { accountDeletionRequests } from "../../../../db/schema";
import { requireUserOrResponse } from "../../../../lib/auth/current-user";
import { cancelAccountDeletion, requestAccountDeletion } from "../../../../lib/account-deletion";

// Self-service half of account deletion — see lib/account-deletion.ts's
// header comment for the full design. Deliberately NOT owner/admin gated
// beyond "signed in as yourself": a user can only ever request, view, or
// cancel their OWN deletion request, never anyone else's (userId always
// comes from the session, never a client-supplied field). The admin-review
// half (approving/denying a held_for_review request) lives at
// app/api/admin/account-deletions/route.ts.

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;

  const [latest] = await getDb()
    .select()
    .from(accountDeletionRequests)
    .where(eq(accountDeletionRequests.userId, auth.id))
    .orderBy(desc(accountDeletionRequests.id))
    .limit(1);
  return Response.json({ request: latest ?? null });
}

export async function POST(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;

  const row = await requestAccountDeletion(auth.id);
  return Response.json({ request: row }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;

  const cancelled = await cancelAccountDeletion(auth.id);
  if (!cancelled) {
    return Response.json({ error: "There is no pending deletion request to cancel." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
