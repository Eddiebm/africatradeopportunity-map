import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { priceLatest, priceObservations, priceRuns } from "../../db/schema";
import type { PriceQuote } from "./types";

function latestKey(quote: PriceQuote): string {
  switch (quote.instrument) {
    case "fx_ghs_per_usd":
      return "fx:USD:GHS";
    case "goods_export_usd_per_kg":
      return `goods_export:${quote.hsCode}:${quote.origin}:${quote.destination}`;
    case "goods_import_usd_per_kg":
      return `goods_import:${quote.hsCode}:${quote.origin}:${quote.destination}`;
    case "mfn_duty_pct":
      return `duty:${quote.hsCode}:${quote.destination}`;
    case "vat_pct":
      return `vat:${quote.destination}`;
    default: {
      const _never: never = quote.instrument;
      return _never;
    }
  }
}

export async function recordQuote(quote: PriceQuote): Promise<string> {
  const db = getDb();
  const key = latestKey(quote);
  const observedAt = quote.asOf;
  await db.insert(priceObservations).values({
    observedAt,
    source: quote.source,
    instrument: quote.instrument,
    hsCode: quote.hsCode || "",
    origin: quote.origin || "",
    destination: quote.destination || "",
    currency: quote.currency,
    unit: quote.unit,
    value: quote.value,
    period: quote.period,
    url: quote.url,
    notes: quote.notes,
    confidence: quote.confidence,
    rawJson: JSON.stringify(quote.raw ?? {}),
  });
  const existing = await db.select({ key: priceLatest.key }).from(priceLatest).where(eq(priceLatest.key, key)).limit(1);
  const row = {
    key,
    instrument: quote.instrument,
    hsCode: quote.hsCode || "",
    origin: quote.origin || "",
    destination: quote.destination || "",
    value: quote.value,
    unit: quote.unit,
    currency: quote.currency,
    source: quote.source,
    period: quote.period,
    url: quote.url,
    notes: quote.notes,
    confidence: quote.confidence,
    asOf: quote.asOf,
    updatedAt: new Date().toISOString(),
  };
  if (existing.length) {
    await db.update(priceLatest).set(row).where(eq(priceLatest.key, key));
  } else {
    await db.insert(priceLatest).values(row);
  }
  return key;
}

export async function loadLatest() {
  return getDb().select().from(priceLatest);
}

export async function startPriceRun() {
  const db = getDb();
  await db.insert(priceRuns).values({ startedAt: new Date().toISOString(), status: "running" });
  const [run] = await db.select().from(priceRuns).orderBy(desc(priceRuns.id)).limit(1);
  if (!run) throw new Error("Could not start a price refresh run.");
  return run;
}

export async function finishPriceRun(id: number, status: "ok" | "error", summary: unknown) {
  await getDb()
    .update(priceRuns)
    .set({
      finishedAt: new Date().toISOString(),
      status,
      summaryJson: JSON.stringify(summary),
    })
    .where(eq(priceRuns.id, id));
}

export async function latestForKey(key: string) {
  const [row] = await getDb().select().from(priceLatest).where(eq(priceLatest.key, key)).limit(1);
  return row || null;
}

export async function latestRun() {
  const [run] = await getDb().select().from(priceRuns).orderBy(desc(priceRuns.id)).limit(1);
  return run || null;
}

export function isFresh(asOf: string | undefined, maxAgeMs: number): boolean {
  if (!asOf) return false;
  const then = Date.parse(asOf);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < maxAgeMs;
}

export async function staleGoodsCorridors(limit = 30) {
  const rows = await getDb().select().from(priceLatest);
  const week = 7 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const stale: Array<{ hsCode: string; origin: string; destination: string }> = [];
  for (const row of rows) {
    if (row.instrument !== "goods_export_usd_per_kg" && row.instrument !== "goods_import_usd_per_kg") continue;
    if (!row.hsCode || !row.origin || !row.destination) continue;
    const id = `${row.hsCode}:${row.origin}:${row.destination}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (isFresh(row.asOf || row.updatedAt, week)) continue;
    stale.push({ hsCode: row.hsCode, origin: row.origin, destination: row.destination });
    if (stale.length >= limit) break;
  }
  return stale;
}
