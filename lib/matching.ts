import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../db";
import { marketRequests, matchCandidates, notifications } from "../db/schema";

export function compatibleRoles(a: string, b: string): boolean {
  return (a === "wanted" && b === "for_sale") || (a === "for_sale" && b === "wanted");
}

export function productKey(value: string): string {
  return value.toLowerCase().replace(/^\d{4,6}\s*[—-]?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function scoreListings(
  a: typeof marketRequests.$inferSelect,
  b: typeof marketRequests.$inferSelect,
) {
  const product =
    productKey(a.product) === productKey(b.product) ||
    (Boolean(a.hsCode) && Boolean(b.hsCode) && a.hsCode.slice(0, 4) === b.hsCode.slice(0, 4))
      ? 40
      : 0;
  const route = a.origin === b.origin && a.destination === b.destination ? 35 : a.destination === b.destination ? 15 : 0;
  const verified = b.status === "verified" ? 15 : 0;
  return { total: product + route + verified + 10, breakdown: { product, route, verified, listingCompleteness: 10 } };
}

export async function refreshMatchesFor(listingId: number): Promise<number> {
  const db = getDb();
  const [listing] = await db.select().from(marketRequests).where(eq(marketRequests.id, listingId)).limit(1);
  if (!listing || listing.status !== "verified") return 0;

  const others = await db
    .select()
    .from(marketRequests)
    .where(and(eq(marketRequests.status, "verified"), ne(marketRequests.id, listing.id)));

  let created = 0;
  for (const other of others) {
    if (!compatibleRoles(listing.role, other.role)) continue;
    if (listing.ownerEmail && other.ownerEmail && listing.ownerEmail === other.ownerEmail) continue;
    const scored = scoreListings(listing, other);
    if (scored.total < 65) continue;
    const demand = listing.role === "wanted" ? listing : other;
    const supply = listing.role === "for_sale" ? listing : other;
    if (demand.role !== "wanted" || supply.role !== "for_sale") continue;
    const id = `M-${demand.id}-${supply.id}`;
    const [existing] = await db.select().from(matchCandidates).where(eq(matchCandidates.id, id)).limit(1);
    if (existing) continue;
    await db.insert(matchCandidates).values({
      id,
      demandRequestId: demand.id,
      supplyRequestId: supply.id,
      score: scored.total,
      scoreBreakdown: JSON.stringify(scored.breakdown),
      status: "suggested",
    });
    created += 1;
    const counterpartEmail = listing.id === demand.id ? supply.ownerEmail : demand.ownerEmail;
    if (counterpartEmail) {
      await db.insert(notifications).values({
        recipientEmail: counterpartEmail,
        eventType: "match_suggested",
        entityType: "match",
        entityId: listing.id,
        titleKey: "match.suggested.title",
        bodyKey: "match.suggested.body",
        payloadJson: JSON.stringify({ matchId: id, product: listing.product }),
      });
    }
  }
  return created;
}
