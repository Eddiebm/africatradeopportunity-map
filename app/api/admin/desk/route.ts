import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { isAdminEmail } from "../../../../lib/session";
import { refreshMatchesFor } from "../../../../lib/matching";
import { dealDocuments, deals, marketRequests, matchCandidates, verificationChecks } from "../../../../db/schema";

type Entity = "request" | "deal" | "check" | "document" | "match";

async function authorize() {
  const user = await getChatGPTUser();
  if (!user) return null;
  if (user.role === "admin" || isAdminEmail(user.email)) return user;
  return null;
}

export async function GET() {
  if (!await authorize()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  const db = getDb();
  const [dealRows, requestRows, checks, documents, matches] = await Promise.all([
    db.select().from(deals).orderBy(desc(deals.id)).limit(100),
    db.select().from(marketRequests).orderBy(desc(marketRequests.id)).limit(100),
    db.select().from(verificationChecks).orderBy(desc(verificationChecks.id)).limit(300),
    db.select().from(dealDocuments).orderBy(desc(dealDocuments.id)).limit(300),
    db.select().from(matchCandidates).orderBy(desc(matchCandidates.createdAt)).limit(200),
  ]);
  return Response.json({ deals: dealRows, requests: requestRows, checks, documents, matches });
}

export async function PATCH(req: Request) {
  const admin = await authorize();
  if (!admin) return Response.json({ error: "Administrator access required." }, { status: 403 });
  const body = await req.json() as { entity?: Entity; id?: number | string; status?: string };
  const status = String(body.status || "");
  const allowed: Record<Entity, string[]> = {
    request: ["pending_verification", "contacted", "verified", "rejected"],
    deal: ["intake", "investigating", "quoted", "matched", "contracting", "in_transit", "delivered", "closed", "rejected"],
    check: ["required", "submitted", "verified", "failed"],
    document: ["required", "submitted", "approved", "rejected"],
    match: ["suggested", "awaiting_counterparty", "mutual_interest", "quoted", "approved", "rejected"],
  };
  const entity = body.entity;
  if (!entity || !(entity in allowed) || !allowed[entity].includes(status)) {
    return Response.json({ error: "Invalid status." }, { status: 400 });
  }
  const db = getDb();
  switch (entity) {
    case "request": {
      const numericId = Number(body.id);
      if (!numericId) return Response.json({ error: "Invalid record." }, { status: 400 });
      await db.update(marketRequests).set({ status }).where(eq(marketRequests.id, numericId));
      if (status === "verified") await refreshMatchesFor(numericId);
      break;
    }
    case "deal": {
      const numericId = Number(body.id);
      if (!numericId) return Response.json({ error: "Invalid record." }, { status: 400 });
      await db.update(deals).set({ stage: status, updatedAt: new Date().toISOString() }).where(eq(deals.id, numericId));
      break;
    }
    case "check": {
      const numericId = Number(body.id);
      if (!numericId) return Response.json({ error: "Invalid record." }, { status: 400 });
      await db.update(verificationChecks).set({
        status,
        reviewerEmail: admin.email,
        checkedAt: new Date().toISOString(),
      }).where(eq(verificationChecks.id, numericId));
      break;
    }
    case "document": {
      const numericId = Number(body.id);
      if (!numericId) return Response.json({ error: "Invalid record." }, { status: 400 });
      await db.update(dealDocuments).set({
        status,
        reviewedBy: admin.email,
        reviewedAt: new Date().toISOString(),
      }).where(eq(dealDocuments.id, numericId));
      break;
    }
    case "match": {
      const matchId = String(body.id || "");
      if (!matchId) return Response.json({ error: "Invalid record." }, { status: 400 });
      await db.update(matchCandidates).set({
        status,
        updatedAt: new Date().toISOString(),
      }).where(eq(matchCandidates.id, matchId));
      break;
    }
    default: {
      const _exhaustive: never = entity;
      return Response.json({ error: "Unhandled entity.", detail: String(_exhaustive) }, { status: 400 });
    }
  }
  return Response.json({ ok: true });
}
