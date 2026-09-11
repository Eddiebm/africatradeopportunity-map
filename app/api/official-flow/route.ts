import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { sourceRecords } from "../../../db/schema";
import { comtradeCodeByName } from "../../../lib/africa-countries";

const FRESH_MS = 24 * 60 * 60 * 1000;
const METRIC = "export_value_usd";

export async function GET(req: Request) {
  const u = new URL(req.url), origin = u.searchParams.get("origin") || "", destination = u.searchParams.get("destination") || "", hs = (u.searchParams.get("hs") || "").replace(/\D/g, "").slice(0, 6);
  if (!comtradeCodeByName[origin] || !comtradeCodeByName[destination] || !hs) return Response.json({ error: "Select two listed African countries and an HS code." }, { status: 400 });

  const db = getDb();
  const cutoff = new Date(Date.now() - FRESH_MS).toISOString();
  const [cached] = await db
    .select()
    .from(sourceRecords)
    .where(and(eq(sourceRecords.reportingCountry, origin), eq(sourceRecords.partnerCountry, destination), eq(sourceRecords.hsCode, hs), eq(sourceRecords.metric, METRIC), gt(sourceRecords.retrievedAt, cutoff)))
    .orderBy(desc(sourceRecords.retrievedAt))
    .limit(1);
  if (cached) {
    return Response.json({ status: "official", source: cached.sourceOrganization, period: cached.period, origin, destination, hs, value: cached.value, sourceUrl: cached.sourceUrl, cache: { status: "cached", retrievedAt: cached.retrievedAt } });
  }

  const source = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2024&reporterCode=${comtradeCodeByName[origin]}&partnerCode=${comtradeCodeByName[destination]}&flowCode=X&cmdCode=${hs}&maxRecords=500`;
  try {
    const res = await fetch(source, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error();
    const json = (await res.json()) as { data?: Array<{ primaryValue?: number; netWgt?: number; qty?: number; period?: string; cmdDesc?: string }> };
    const rows = json.data || [];
    const value = rows.reduce((s, r) => s + (r.primaryValue || 0), 0);
    const weight = rows.reduce((s, r) => s + (r.netWgt || 0), 0);
    const now = new Date().toISOString();
    await db.insert(sourceRecords).values({ sourceOrganization: "UN Comtrade", sourceUrl: source, reportingCountry: origin, partnerCountry: destination, hsCode: hs, period: "2024", metric: METRIC, value, unit: "USD", evidenceCategory: rows.length ? "official" : "estimated", methodology: "Annual reported exports, corridor-specific", limitations: rows.length ? "" : "No matching record returned.", retrievedAt: now });
    return Response.json({ status: "official", source: "UN Comtrade preview API", period: "2024", origin, destination, hs, value, netWeightKg: weight, records: rows.length, sourceUrl: source, warning: rows.length ? null : "No matching record returned; this is not proof that no informal trade occurred.", cache: { status: "live", retrievedAt: now } });
  } catch {
    return Response.json({ error: "UN Comtrade did not answer this lookup. Try the official source directly.", sourceUrl: source }, { status: 502 });
  }
}
