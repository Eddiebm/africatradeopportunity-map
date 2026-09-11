// Priority 5 (docs/production-readiness.md): the public, curated view —
// "Create explicit distinctions between: Intelligence coverage /
// Operationally supported corridors / TradeSafe Verified corridors."
// Unauthenticated by design (a prospective trader needs to see this
// before signing up — see Priority 9's "don't require full account
// creation before showing preliminary value").
//
// Deliberately excludes riskRules/escalationRules/requiredBuyerInfo/
// requiredSupplierInfo — those are operational detail for staff running
// a corridor, not something to publish (a bad actor reading published
// risk-escalation rules could use them to structure around detection).
// Everything returned here is safe, useful context for a prospective
// user: what tier a corridor is in, why (confidence/source/reviewer),
// and when it was last reviewed.
import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { corridorTemplates } from "../../../db/schema";

export async function GET() {
  const db = getDb();
  // FIX (production-hardening audit, PR review finding): every version
  // of EVERY corridor, suspended included — the "exclude suspended"
  // filter must run AFTER collapsing to "current version only" below,
  // not before. The old query filtered out suspended rows first, so a
  // corridor whose LATEST version was suspended silently fell back to
  // an older, stale "operational" version being published as current —
  // exactly the "TradeSafe Verified" tier being asserted for a corridor
  // that's actually been suspended. Only each corridor's real current
  // version should ever decide what the public sees.
  const rows = await db
    .select()
    .from(corridorTemplates)
    .orderBy(desc(corridorTemplates.corridorKey), desc(corridorTemplates.version));

  const currentByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!currentByKey.has(row.corridorKey)) currentByKey.set(row.corridorKey, row); // first seen per key = highest version, given the ORDER BY
  }

  // Suspended corridors are excluded entirely from the public view (see
  // db/schema.ts's CORRIDOR_TEMPLATE_STATUSES) — a suspended corridor
  // isn't "worse intelligence coverage," it's actively not offered. This
  // now checks each corridor's real CURRENT version's status, not a
  // pre-filtered set that may already have dropped the current row.
  const corridors = [...currentByKey.values()]
    .filter((row) => row.status !== "suspended")
    .map((row) => ({
    origin: row.origin,
    destination: row.destination,
    tier: row.status === "operational" ? "verified" : "operational",
    status: row.status,
    confidence: row.confidence,
    expectedTiming: row.expectedTiming,
    productCategories: JSON.parse(row.productCategoriesJson || "[]"),
    sourceAttribution: row.sourceAttribution,
    lastReviewedAt: row.lastReviewedAt,
    version: row.version,
  }));

  return Response.json({ corridors });
}
