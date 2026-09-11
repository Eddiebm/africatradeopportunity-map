// GET /api/opportunities — the real, source-backed replacement for the old
// hardcoded `candidates` array in app/opportunities/page.tsx (see
// docs/AUDIT.md §3). Ranks (product, origin, destination) candidates by
// real demand signal (lib/trade-intelligence.ts, cached UN Comtrade/World
// Bank data) and real verified-listing evidence (db/schema.ts's
// marketRequests). Never invents a buyer, a landed cost, or a profit
// figure — see the "Cost/profit" note below for why none is computed here.
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { marketRequests } from "../../../db/schema";
import { africaCountries } from "../../../lib/africa-countries";
import { getImportIntelligence, type ImportIntelligence } from "../../../lib/trade-intelligence";

// --- Candidate universe -----------------------------------------------------
// A live Comtrade+World Bank fetch per candidate per request isn't viable
// (rate limits, latency) — that's exactly why lib/trade-intelligence.ts's D1
// cache exists. So the candidate universe is a bounded, curated grid:
//
//   destinations × products, each hit ONCE via getImportIntelligence()
//   (cache-first; only a genuine cache miss falls through to a live fetch).
//
// Products: the same curated HS4 list already used by the product picker in
// app/components/ImportIntelligence.tsx and app/page.tsx's product desk
// (and the six fictional candidates this route replaces) — reusing the
// product set the rest of the app already talks about, not inventing a new
// one.
const CURATED_PRODUCTS: Array<[hs: string, name: string]> = [
  ["0702", "Tomatoes"],
  ["0703", "Onions"],
  ["1006", "Rice"],
  ["1207", "Oilseeds"],
  ["1509", "Vegetable oils"],
  ["1801", "Cocoa beans"],
  ["2523", "Cement"],
  ["2710", "Refined petroleum"],
  ["3004", "Medicines"],
  ["7208", "Flat-rolled steel"],
  ["8701", "Tractors"],
  ["0102", "Live cattle"],
];

// Destinations: when the trader names a country, that's the only
// destination queried (12 calls — one per product). When they leave it at
// "All", we query a small set of high-trade-volume anchor countries instead
// of all 54 — one representative per major African trading bloc, in the
// same spirit as app/page.tsx's `profiles` regional groupings (kept as an
// independent list here, not imported, since app/page.tsx's `lanes` section
// is being edited concurrently elsewhere and is off-limits to this change).
// 4 hubs × 12 products = 48 getImportIntelligence calls — a "few dozen,"
// not "hundreds," per docs/AUDIT.md's brief, and every one of those is a D1
// cache read in the common case.
const HUB_DESTINATIONS = ["Ghana", "Kenya", "South Africa", "Egypt"];

// Origins are NOT a hand-picked neighbor list: for each (destination, hs)
// pair, the origin candidates are the actual top African suppliers Comtrade
// partner-country data recorded for that product+destination — i.e.
// intel.supply.africanSuppliers, which getImportIntelligence() already
// computes and sorts by recorded value. Using the real recorded top
// supplier(s) as "origin" is a stronger, more honest signal than guessing a
// plausible neighbor, and costs zero extra fetches since it comes free with
// the demand call. Up to 2 origin candidates per (destination, hs) pair
// when supply is recorded; when Comtrade has no African partner record at
// all for that pair, we still surface exactly one candidate so the demand
// signal isn't hidden — with origin explicitly marked "not yet recorded"
// rather than guessed.
const MAX_ORIGINS_PER_PAIR = 2;

const VALID_COUNTRIES = new Set<string>(africaCountries.map(([name]) => name));

const productKey = (s: string) => s.toLowerCase().replace(/^\d{4,6}\s*[—-]?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
const hsMatches = (candidateHs: string, rowHs: string, rowProduct: string, candidateProduct: string) =>
  (rowHs && rowHs.replace(/\D/g, "").slice(0, 4) === candidateHs) || productKey(rowProduct) === productKey(candidateProduct);

export type OpportunityCandidate = {
  product: string;
  hsCode: string;
  origin: string;
  destination: string;
  route: string;
  demand: {
    direction: string;
    growthRate: number;
    confidence: number;
    method: string;
    nextYear: number;
    forecastValue: number;
    currentYear: number;
    currentYearValue: number;
    currentYearMonthsReported: number;
    historyYears: string[];
  };
  supply: {
    hasRecordedOrigin: boolean;
    originValue: number;
    originShare: number;
    worldImports: number;
    status: string;
  };
  buyerEvidence: {
    verifiedBuyerListing: boolean;
    verifiedSupplierListing: boolean;
    status: string;
  };
  sources: Array<{ name: string; type: string; url: string }>;
  sourceDates: string[];
  cacheStatus: "live" | "cached";
  score: number;
  breakdown: { demand: number; supply: number; buyerEvidence: number; forecastConfidence: number };
  recommendedNextAction: string;
};

export type OpportunitiesResponse = {
  candidates: OpportunityCandidate[];
  meta: {
    destinationsQueried: string[];
    productsQueried: number;
    candidateUniverseSize: number;
    afterFilters: number;
    capitalFilterApplied: boolean;
    generatedAt: string;
  };
};

function scoreCandidate(intel: ImportIntelligence, supplier: { country: string; value: number; share: number } | null, hasBuyer: boolean) {
  // Demand (0-40): rising/stable/falling direction from the real forecast —
  // see lib/trade-intelligence.ts's `direction` computation. growthRate and
  // confidence are shown alongside, not silently folded into more points,
  // so every point on the score traces to a labeled, visible factor.
  const directionPoints = intel.outlook.direction === "rising" ? 40 : intel.outlook.direction === "stable" ? 24 : 8;
  // Supply evidence (0-25): does a real Comtrade-recorded African supplier
  // exist for this product+destination, and how large is their recorded
  // share of world imports.
  const supplyPoints = supplier ? Math.round(10 + Math.min(1, supplier.share) * 15) : 0;
  // Buyer/supplier-listing evidence (0-25): a literal, checkable
  // status:"verified" marketRequests row for this product+corridor. Never a
  // guess — either the row exists or it doesn't.
  const buyerPoints = hasBuyer ? 25 : 0;
  // Forecast reliability bonus (0-10): the outlook's own stated confidence,
  // scaled down rather than treated as free extra demand points.
  const confidencePoints = Math.round((intel.outlook.confidence / 100) * 10);
  const total = directionPoints + supplyPoints + buyerPoints + confidencePoints;
  return { total, breakdown: { demand: directionPoints, supply: supplyPoints, buyerEvidence: buyerPoints, forecastConfidence: confidencePoints } };
}

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const countryParam = query.get("country") || "All";
  const country = countryParam !== "All" && VALID_COUNTRIES.has(countryParam) ? countryParam : "All";
  // "Available capital" can no longer filter against a fabricated landed
  // cost — see docs/AUDIT.md and the mission brief. Repurposed as a market
  // scale filter against intel.supply.worldImports (real, recorded, from
  // Comtrade), labeled in the UI as indicative of market size, not a cost
  // estimate. A candidate whose worldImports figure is unavailable (0) is
  // never excluded by this filter — there's nothing real to compare
  // against, so we show it with a note instead of guessing.
  const capital = Math.max(0, Number(query.get("capital")) || 0);
  // "Risk tolerance" can no longer filter against a fabricated risk score.
  // Repurposed as a forecast-uncertainty tolerance: uncertainty = 100 -
  // outlook.confidence (a real, computed field — see
  // lib/trade-intelligence.ts). Lower confidence forecasts are excluded
  // when the trader sets a lower tolerance.
  const riskParam = query.get("risk");
  const maxUncertainty = riskParam === null ? 100 : Math.max(0, Math.min(100, Number(riskParam)));

  const destinations: string[] = country === "All" ? HUB_DESTINATIONS : [country];

  const pairs = destinations.flatMap((destination) => CURATED_PRODUCTS.map(([hs, name]) => ({ destination, hs, name })));
  const results = await Promise.allSettled(pairs.map((pair) => getImportIntelligence(pair.destination, pair.hs)));

  const db = getDb();
  const verifiedListings = await db.select({
    role: marketRequests.role,
    origin: marketRequests.origin,
    destination: marketRequests.destination,
    product: marketRequests.product,
    hsCode: marketRequests.hsCode,
  }).from(marketRequests).where(eq(marketRequests.status, "verified")).limit(500);

  const candidates: OpportunityCandidate[] = [];
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return; // one failed lookup shouldn't sink the whole ranked list
    const intel = result.value;
    const { destination, hs, name } = pairs[i];
    const suppliers = intel.supply.africanSuppliers.slice(0, MAX_ORIGINS_PER_PAIR);
    const originCandidates: Array<{ country: string; value: number; share: number } | null> = suppliers.length
      ? suppliers.map((s) => ({ country: s.country, value: s.value, share: s.share }))
      : [null];

    for (const supplier of originCandidates) {
      const origin = supplier?.country || "Not yet recorded";
      const hasBuyer = verifiedListings.some((r) => r.role === "wanted" && r.destination === destination && hsMatches(hs, r.hsCode, r.product, name));
      const hasSupplierListing = verifiedListings.some((r) => r.role === "for_sale" && supplier && r.origin === supplier.country && hsMatches(hs, r.hsCode, r.product, name));
      const { total, breakdown } = scoreCandidate(intel, supplier, hasBuyer);
      const buyerStatus = hasBuyer
        ? `Verified buyer listing recorded for this product into ${destination}.`
        : "Promising market—no verified buyer yet.";

      candidates.push({
        product: name,
        hsCode: hs,
        origin,
        destination,
        route: `${origin} → ${destination}`,
        demand: {
          direction: intel.outlook.direction,
          growthRate: intel.outlook.growthRate,
          confidence: intel.outlook.confidence,
          method: intel.outlook.method,
          nextYear: intel.outlook.nextYear,
          forecastValue: intel.outlook.value,
          currentYear: intel.current.year,
          currentYearValue: intel.current.value,
          currentYearMonthsReported: intel.current.monthsReported,
          historyYears: intel.annual.filter((a) => a.status !== "not-reported").map((a) => a.period),
        },
        supply: {
          hasRecordedOrigin: Boolean(supplier),
          originValue: supplier?.value || 0,
          originShare: supplier?.share || 0,
          worldImports: intel.supply.worldImports,
          status: supplier ? "official-recorded-supply" : "no-african-supplier-record-returned",
        },
        buyerEvidence: {
          verifiedBuyerListing: hasBuyer,
          verifiedSupplierListing: hasSupplierListing,
          status: buyerStatus,
        },
        sources: intel.sources,
        sourceDates: [
          `Comtrade annual: ${intel.annual[0]?.period || "?"}–${intel.annual.at(-1)?.period || "?"}`,
          `Retrieved ${intel.cache.retrievedAt}`,
        ],
        cacheStatus: intel.cache.status,
        score: total,
        breakdown,
        recommendedNextAction: hasBuyer
          ? "Open an investigation — a verified buyer is already listed for this corridor."
          : supplier
            ? "Promising market—no verified buyer yet. Post a listing to start finding one."
            : "Promising market—no verified buyer yet. Recorded African supply is also thin for this corridor — verify sourcing before committing capital.",
      });
    }
  });

  const capitalFilterApplied = capital > 0;
  const filtered = candidates.filter((c) => {
    const uncertainty = 100 - c.demand.confidence;
    if (uncertainty > maxUncertainty) return false;
    if (capitalFilterApplied && c.supply.worldImports > 0 && c.supply.worldImports < capital) return false;
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 40);

  const body: OpportunitiesResponse = {
    candidates: filtered,
    meta: {
      destinationsQueried: destinations,
      productsQueried: CURATED_PRODUCTS.length,
      candidateUniverseSize: candidates.length,
      afterFilters: filtered.length,
      capitalFilterApplied,
      generatedAt: new Date().toISOString(),
    },
  };
  return Response.json(body);
}
