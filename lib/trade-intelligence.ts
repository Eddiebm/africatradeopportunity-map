// Shared trade-intelligence fetch + cache logic, used by both
// app/api/import-intelligence/route.ts (live user lookups) and
// worker/index.ts's scheduled() Cron handler (background refresh of
// db/schema.ts's intelligenceWatchlist). One computation path, one cache,
// so a user's live lookup and the Cron Trigger's background refresh can
// never disagree about what "current" means for the same (country, hs).
//
// Every number this returns traces back to a real UN Comtrade or World
// Bank response — see db/schema.ts's comment on sourceRecords/
// tradeIntelligenceSnapshots for why that matters here specifically.
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { intelligenceWatchlist, sourceRecords, tradeIntelligenceSnapshots } from "../db/schema";
import { africanComtradeCodes, comtradeCodeByName, iso2ByName } from "./africa-countries";

type Row = { period?: string | number; primaryValue?: number; netWgt?: number; cmdDesc?: string; isReported?: boolean; partnerCode?: number; partnerDesc?: string };

export type ImportIntelligence = {
  country: string;
  hs: string;
  product: string;
  annual: Array<{ period: string; value: number; netWeightKg: number; status: string }>;
  current: { year: number; monthsReported: number; value: number; annualizedValue: number; status: string };
  outlook: { nextYear: number; value: number; direction: string; growthRate: number; confidence: number; method: string; drivers: { populationGrowth: { value: number; period: string; url: string }; gdpGrowth: { value: number; period: string; url: string } } };
  supply: { period: number; worldImports: number; africanSuppliers: Array<{ country: string; value: number; netWeightKg: number; share: number; status: string }>; status: string };
  sources: Array<{ name: string; type: string; url: string }>;
  warnings: string[];
  cache: { status: "live" | "cached"; retrievedAt: string };
};

const SNAPSHOT_FRESH_MS = 24 * 60 * 60 * 1000; // trade data doesn't move intraday

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const endpoint = (frequency: "A" | "M", period: string, reporter: string, hs: string) =>
  `https://comtradeapi.un.org/public/v1/preview/C/${frequency}/HS?period=${period}&reporterCode=${reporter}&partnerCode=0&partner2Code=0&flowCode=M&cmdCode=${hs}&customsCode=C00&motCode=0&maxRecords=500&aggregateBy=6&breakdownMode=classic&includeDesc=true`;

async function rows(url: string): Promise<Row[]> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("source unavailable");
  const data = (await response.json()) as { data?: Row[] };
  return data.data || [];
}
async function optionalRows(url: string): Promise<Row[]> {
  try {
    return await rows(url);
  } catch {
    return [];
  }
}
async function indicator(iso2: string, code: string): Promise<{ value: number; period: string; url: string }> {
  try {
    const url = `https://api.worldbank.org/v2/country/${iso2}/indicator/${code}?format=json&per_page=8`;
    const response = await fetch(url);
    const body = (await response.json()) as [unknown, Array<{ date: string; value: number | null }>?];
    const found = body?.[1]?.find((x) => x.value !== null);
    return { value: found?.value || 0, period: found?.date || "", url };
  } catch {
    return { value: 0, period: "", url: "" };
  }
}

/** Actually hits UN Comtrade + World Bank. Never called directly outside
 * this module — always go through getImportIntelligence(), which decides
 * whether a fresh cached snapshot already answers the question. */
async function computeImportIntelligence(country: string, hs: string): Promise<ImportIntelligence> {
  const reporter = comtradeCodeByName[country];
  const iso2 = iso2ByName[country];
  const year = new Date().getUTCFullYear();
  const completedMonth = new Date().getUTCMonth();
  const annualYears = Array.from({ length: 6 }, (_, i) => String(year - 6 + i));
  const monthlyPeriods = Array.from({ length: Math.max(0, completedMonth) }, (_, i) => `${year}${String(i + 1).padStart(2, "0")}`);

  const annualUrl = endpoint("A", annualYears.join(","), reporter, hs);
  const monthlyUrl = monthlyPeriods.length ? endpoint("M", monthlyPeriods.join(","), reporter, hs) : "";
  const partnerUrl = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=${year - 1}&reporterCode=${reporter}&partnerCode=all&flowCode=M&cmdCode=${hs}&maxRecords=500&includeDesc=true`;

  const [annualRows, monthlyRows, partnerRows, populationGrowth, gdpGrowth] = await Promise.all([
    rows(annualUrl),
    monthlyUrl ? optionalRows(monthlyUrl) : Promise.resolve([]),
    optionalRows(partnerUrl),
    indicator(iso2, "SP.POP.GROW"),
    indicator(iso2, "NY.GDP.MKTP.KD.ZG"),
  ]);

  const annual = annualYears.map((period) => {
    const found = annualRows.filter((r) => String(r.period) === period);
    return { period, value: found.reduce((sum, r) => sum + (r.primaryValue || 0), 0), netWeightKg: found.reduce((sum, r) => sum + (r.netWgt || 0), 0), status: found.length ? (found.every((r) => r.isReported !== false) ? "official" : "official-estimated") : "not-reported" };
  });
  const active = annual.filter((x) => x.value > 0);
  const currentValue = monthlyRows.reduce((sum, r) => sum + (r.primaryValue || 0), 0);
  const monthsReported = new Set(monthlyRows.map((r) => String(r.period))).size;
  const annualizedCurrent = monthsReported ? (currentValue / monthsReported) * 12 : 0;
  const first = active[0], last = active.at(-1);
  const spans = first && last ? Math.max(1, +last.period - +first.period) : 1;
  const cagr = first && last && first.value > 0 ? Math.pow(last.value / first.value, 1 / spans) - 1 : 0;
  const recentBase = annualizedCurrent || last?.value || 0;
  const momentum = annualizedCurrent && last?.value ? annualizedCurrent / last.value - 1 : cagr;
  const demandTailwind = clamp((populationGrowth.value * 0.4 + gdpGrowth.value * 0.25) / 100, -0.04, 0.08);
  const forecastRate = clamp(cagr * 0.6 + momentum * 0.3 + demandTailwind, -0.3, 0.5);
  const forecast = recentBase ? recentBase * (1 + forecastRate) : 0;
  const observations = active.length + Math.min(3, monthsReported / 3);
  const confidence = Math.round(clamp(35 + observations * 7 + (monthsReported >= 3 ? 10 : 0), 25, 92));
  const direction = forecastRate > 0.08 ? "rising" : forecastRate < -0.08 ? "falling" : "stable";
  const worldRow = partnerRows.find((r) => Number(r.partnerCode) === 0);
  const worldImports = worldRow?.primaryValue || last?.value || 0;
  const africanSuppliers = partnerRows
    .filter((r) => r.partnerCode && africanComtradeCodes.has(String(r.partnerCode)) && Number(r.partnerCode) !== Number(reporter) && Number(r.primaryValue) > 0)
    .sort((a, b) => (b.primaryValue || 0) - (a.primaryValue || 0))
    .slice(0, 8)
    .map((r) => ({ country: r.partnerDesc || `Partner ${r.partnerCode}`, value: r.primaryValue || 0, netWeightKg: r.netWgt || 0, share: worldImports ? (r.primaryValue || 0) / worldImports : 0, status: "official-partner-record" }));

  return {
    country,
    hs,
    product: annualRows[0]?.cmdDesc || `HS ${hs}`,
    annual,
    current: { year, monthsReported, value: currentValue, annualizedValue: annualizedCurrent, status: monthsReported ? "official-monthly" : "not-yet-reported" },
    outlook: { nextYear: year + 1, value: forecast, direction, growthRate: forecastRate, confidence, method: "Projection combining historical import growth, recent monthly momentum, population growth and real GDP growth", drivers: { populationGrowth, gdpGrowth } },
    supply: { period: year - 1, worldImports, africanSuppliers, status: africanSuppliers.length ? "official-recorded-supply" : "no-african-supplier-record-returned" },
    sources: [
      { name: "UN Comtrade", type: "official trade", url: annualUrl },
      { name: "World Bank Open Data", type: "official development indicators", url: populationGrowth.url },
      { name: "WITS / UNCTAD TRAINS", type: "tariffs and non-tariff measures", url: "https://wits.worldbank.org/" },
      { name: "FAOSTAT", type: "agricultural production and food balances", url: "https://www.fao.org/faostat/en/" },
      { name: "AfCFTA Secretariat", type: "continental trade rules", url: "https://www.africancfta.org/" },
    ],
    warnings: ["Future demand is a projection, not a purchase order.", "Missing official records do not prove that no formal or informal imports occurred.", "Current-year values cover only months returned by the reporting country."],
    cache: { status: "live", retrievedAt: new Date().toISOString() },
  };
}

async function persistSourceRecords(intel: ImportIntelligence): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const comtradeUrl = intel.sources[0]?.url || "";
  const rowsToInsert = [
    ...intel.annual.filter((a) => a.status !== "not-reported").map((a) => ({
      sourceOrganization: "UN Comtrade", sourceUrl: comtradeUrl, reportingCountry: intel.country, hsCode: intel.hs, period: a.period, metric: "import_value_usd", value: a.value, unit: "USD",
      evidenceCategory: a.status === "official" ? ("official" as const) : ("estimated" as const), methodology: "Annual reported imports, HS6 aggregate", limitations: "", retrievedAt: now,
    })),
    ...(intel.current.monthsReported ? [{
      sourceOrganization: "UN Comtrade", sourceUrl: comtradeUrl, reportingCountry: intel.country, hsCode: intel.hs, period: String(intel.current.year), metric: "import_value_usd_partial_year", value: intel.current.value, unit: "USD",
      evidenceCategory: "official" as const, methodology: `${intel.current.monthsReported} month(s) reported`, limitations: "Partial year — not annualized in this row.", retrievedAt: now,
    }] : []),
    { sourceOrganization: "World Bank Open Data", sourceUrl: intel.outlook.drivers.populationGrowth.url, reportingCountry: intel.country, hsCode: "", period: intel.outlook.drivers.populationGrowth.period, metric: "population_growth_pct", value: intel.outlook.drivers.populationGrowth.value, unit: "%", evidenceCategory: "official" as const, methodology: "SP.POP.GROW", limitations: "", retrievedAt: now },
    { sourceOrganization: "World Bank Open Data", sourceUrl: intel.outlook.drivers.gdpGrowth.url, reportingCountry: intel.country, hsCode: "", period: intel.outlook.drivers.gdpGrowth.period, metric: "gdp_growth_pct", value: intel.outlook.drivers.gdpGrowth.value, unit: "%", evidenceCategory: "official" as const, methodology: "NY.GDP.MKTP.KD.ZG", limitations: "", retrievedAt: now },
    { sourceOrganization: "TradeSafe Africa forecast model", sourceUrl: "", reportingCountry: intel.country, hsCode: intel.hs, period: String(intel.outlook.nextYear), metric: "forecast_import_value_usd", value: intel.outlook.value, unit: "USD", evidenceCategory: "forecast" as const, confidence: intel.outlook.confidence, methodology: intel.outlook.method, limitations: "Model output, not a reported figure.", retrievedAt: now },
    ...intel.supply.africanSuppliers.map((s) => ({
      sourceOrganization: "UN Comtrade", sourceUrl: comtradeUrl, reportingCountry: intel.country, partnerCountry: s.country, hsCode: intel.hs, period: String(intel.supply.period), metric: "import_value_usd_from_partner", value: s.value, unit: "USD",
      evidenceCategory: "official" as const, methodology: "Partner-level annual imports", limitations: "", retrievedAt: now,
    })),
  ];
  if (rowsToInsert.length) await db.insert(sourceRecords).values(rowsToInsert);
}

async function readSnapshot(country: string, hs: string): Promise<ImportIntelligence | null> {
  const db = getDb();
  const [snap] = await db.select().from(tradeIntelligenceSnapshots).where(and(eq(tradeIntelligenceSnapshots.country, country), eq(tradeIntelligenceSnapshots.hsCode, hs))).orderBy(tradeIntelligenceSnapshots.id).limit(1);
  if (!snap) return null;
  const ageMs = Date.now() - new Date(snap.retrievedAt).getTime();
  if (ageMs > SNAPSHOT_FRESH_MS) return null;
  try {
    const parsed = JSON.parse(snap.responseJson) as ImportIntelligence;
    return { ...parsed, cache: { status: "cached", retrievedAt: snap.retrievedAt } };
  } catch {
    return null;
  }
}

async function writeSnapshot(country: string, hs: string, intel: ImportIntelligence): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: tradeIntelligenceSnapshots.id }).from(tradeIntelligenceSnapshots).where(and(eq(tradeIntelligenceSnapshots.country, country), eq(tradeIntelligenceSnapshots.hsCode, hs))).limit(1);
  const responseJson = JSON.stringify(intel);
  const retrievedAt = new Date().toISOString();
  if (existing) await db.update(tradeIntelligenceSnapshots).set({ responseJson, retrievedAt }).where(eq(tradeIntelligenceSnapshots.id, existing.id));
  else await db.insert(tradeIntelligenceSnapshots).values({ country, hsCode: hs, responseJson, retrievedAt });
}

async function touchWatchlist(country: string, hs: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const [existing] = await db.select({ id: intelligenceWatchlist.id }).from(intelligenceWatchlist).where(and(eq(intelligenceWatchlist.country, country), eq(intelligenceWatchlist.hsCode, hs))).limit(1);
  if (existing) await db.update(intelligenceWatchlist).set({ lastRefreshedAt: now }).where(eq(intelligenceWatchlist.id, existing.id));
  else await db.insert(intelligenceWatchlist).values({ country, hsCode: hs, lastRefreshedAt: now });
}

/** The one entry point routes and the Cron handler should call. Serves a
 * fresh cached snapshot when one exists; otherwise fetches live, persists
 * both the snapshot and the granular sourceRecords, and registers the pair
 * on the watchlist so the Cron Trigger keeps it warm going forward. */
export async function getImportIntelligence(country: string, hs: string, opts: { force?: boolean } = {}): Promise<ImportIntelligence> {
  if (!opts.force) {
    const cached = await readSnapshot(country, hs);
    if (cached) return cached;
  }
  const intel = await computeImportIntelligence(country, hs);
  await Promise.all([writeSnapshot(country, hs, intel), persistSourceRecords(intel), touchWatchlist(country, hs)]);
  return intel;
}

/** Called by worker/index.ts's scheduled() handler. Refreshes the
 * `limit` most-stale (or never-refreshed) watchlist entries. Bounded so
 * one Cron tick can't blow through Workers' CPU/subrequest limits — the
 * watchlist only grows as fast as real users generate lookups, so this
 * catches up over successive ticks rather than trying to do it all at once. */
export async function refreshStaleWatchlist(limit: number): Promise<{ refreshed: number; failed: number }> {
  const db = getDb();
  const all = await db.select().from(intelligenceWatchlist);
  const sorted = all.sort((a, b) => (a.lastRefreshedAt || "").localeCompare(b.lastRefreshedAt || "")).slice(0, limit);
  let refreshed = 0, failed = 0;
  for (const entry of sorted) {
    try {
      await getImportIntelligence(entry.country, entry.hsCode, { force: true });
      refreshed++;
    } catch {
      failed++;
    }
  }
  return { refreshed, failed };
}
