// Priority 5 (docs/production-readiness.md): the explicit three-tier
// distinction the mission requires — "Do not attempt to operationalize
// every African country." Server Component (no auth required, matches
// app/api/corridor-templates/route.ts being public) so this is real,
// server-rendered content a prospective trader can see before signing up.
// Queries the DB directly rather than fetching app/api/corridor-templates/
// itself — same data, same "current version per corridor, exclude
// suspended" logic, just without a self-referential HTTP round trip
// (the same pattern every other Server Component page in this app uses).
import { desc, ne } from "drizzle-orm";
import { getDb } from "../../db";
import { corridorTemplates } from "../../db/schema";

export const dynamic = "force-dynamic";

type PublicCorridor = {
  origin: string;
  destination: string;
  tier: "operational" | "verified";
  status: string;
  confidence: string;
  expectedTiming: string;
  productCategories: string[];
  sourceAttribution: string;
  lastReviewedAt: string | null;
  version: number;
};

export default async function Corridors() {
  const db = getDb();
  const rows = await db
    .select()
    .from(corridorTemplates)
    .where(ne(corridorTemplates.status, "suspended"))
    .orderBy(desc(corridorTemplates.corridorKey), desc(corridorTemplates.version));
  const currentByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!currentByKey.has(row.corridorKey)) currentByKey.set(row.corridorKey, row);
  const corridors: PublicCorridor[] = [...currentByKey.values()].map((row) => ({
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

  const verified = corridors.filter((c) => c.tier === "verified");
  const operational = corridors.filter((c) => c.tier === "operational");

  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Corridor coverage</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/opportunities">Find an opportunity</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>WHAT WE ACTUALLY SUPPORT</p>
          <h1>Three different things, on purpose</h1>
        </div>
        <aside style={{ maxWidth: 420, fontSize: 12, lineHeight: 1.6 }}>
          We do not claim to operationally support every African corridor.
          These are three different, clearly separated claims — read the
          difference before you rely on any of them.
        </aside>
      </section>

      <section className="roomgrid" style={{ gridTemplateColumns: "1fr" }}>
        <article>
          <div className="roomtitle">
            <small>TIER 1 — INTELLIGENCE COVERAGE</small>
            <b>All 54 African countries</b>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: "#556" }}>
            Real, source-attributed trade data (UN Comtrade, World Bank) is available for every
            country pair via the{" "}
            <a href="/opportunities">Opportunity Finder</a> and{" "}
            <a href="/">Atlas</a>. This is intelligence, not an operational commitment — it does
            not mean we have a documented process, verified partners, or a supported transaction
            workflow for that corridor.
          </p>
        </article>

        <article>
          <div className="roomtitle">
            <small>TIER 2 — OPERATIONALLY SUPPORTED</small>
            <b>{operational.length} corridor{operational.length === 1 ? "" : "s"}</b>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: "#556" }}>
            A documented corridor template exists — required documents, verification steps,
            standard milestones — but it is still in draft or under review, not independently
            confirmed. Treat this as a working process, not a guarantee.
          </p>
          {operational.length ? (
            operational.map((c) => <CorridorRow key={`${c.origin}-${c.destination}-${c.version}`} c={c} />)
          ) : (
            <p style={{ fontSize: 11, color: "#757588" }}>No corridors currently in this tier.</p>
          )}
        </article>

        <article>
          <div className="roomtitle">
            <small>TIER 3 — TRADESAFE VERIFIED</small>
            <b>{verified.length} corridor{verified.length === 1 ? "" : "s"}</b>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: "#556" }}>
            A documented corridor template has been reviewed and marked operational, with a named
            reviewer and a named source for its rules (see each entry below). This still does not
            mean TradeSafe holds money, guarantees delivery, or eliminates risk — see{" "}
            <a href="/legal/terms">Terms</a>.
          </p>
          {verified.length ? (
            verified.map((c) => <CorridorRow key={`${c.origin}-${c.destination}-${c.version}`} c={c} />)
          ) : (
            <p style={{ fontSize: 11, color: "#757588" }}>No corridors currently in this tier.</p>
          )}
        </article>
      </section>
    </main>
  );
}

function CorridorRow({ c }: { c: PublicCorridor }) {
  return (
    <div className="task">
      <i>{c.tier === "verified" ? "✓" : "…"}</i>
      <span>
        <b>
          {c.origin} → {c.destination}
        </b>
        <small>
          {c.status} · confidence: {c.confidence} · {c.expectedTiming || "timing not documented"}
          {c.lastReviewedAt ? ` · reviewed ${c.lastReviewedAt.slice(0, 10)}` : " · not yet reviewed"}
        </small>
        {c.sourceAttribution && <em style={{ fontSize: 10, color: "#657687" }}>{c.sourceAttribution}</em>}
      </span>
    </div>
  );
}
