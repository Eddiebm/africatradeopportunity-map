import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { dealEvents, deals, documentFiles, verificationChecks } from "../../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../../lib/auth/current-user";

// The deal owner can attach an already-uploaded file as the evidence behind
// a verification check. This never changes verificationChecks.status —
// attaching evidence isn't verifying it; an administrator still reviews and
// marks the check verified separately (app/api/admin/desk/route.ts, not
// touched here). expiresAt is likewise left untouched by this route — there
// is no admin-side control for it yet (see docs/AUDIT.md follow-ups).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; checkId: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const { id, checkId } = await params;
  const dealId = Number(id);
  const chkId = Number(checkId);
  if (!dealId || !chkId) return Response.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { documentFileId?: number } | null;
  const documentFileId = Number(body?.documentFileId);
  if (!documentFileId) return Response.json({ error: "documentFileId is required." }, { status: 400 });

  const db = getDb();
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.ownerEmail, user.email))).limit(1);
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

  const [check] = await db.select().from(verificationChecks).where(and(eq(verificationChecks.id, chkId), eq(verificationChecks.dealId, dealId))).limit(1);
  if (!check) return Response.json({ error: "Verification check not found." }, { status: 404 });

  // Never trust a client-supplied file id without confirming it belongs to
  // this deal and is still active.
  const [file] = await db.select().from(documentFiles).where(and(eq(documentFiles.id, documentFileId), eq(documentFiles.dealId, dealId), eq(documentFiles.fileStatus, "active"))).limit(1);
  if (!file) return Response.json({ error: "That file is not an active document on this deal." }, { status: 404 });

  await db.update(verificationChecks).set({ evidenceFileId: file.id }).where(eq(verificationChecks.id, chkId));
  await db.insert(dealEvents).values({
    dealId,
    actorEmail: user.email,
    eventType: "check_evidence_attached",
    summary: `Evidence attached for "${check.checkType.replaceAll("_", " ")}" check — ${file.originalName}`,
  });

  return Response.json({ ok: true });
}
