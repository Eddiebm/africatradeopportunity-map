import { assembleCorridor, assemblePack, dutyQuoteForLane } from "./assemble";
import { productLabel } from "./catalog";
import { REFERENCE_LANES, parseHs, parseShipmentKg } from "./lanes";
import {
  fetchExportUnitValue,
  fetchImportUnitValue,
  fetchUsdGhs,
  scheduleDuty,
  scheduleVat,
} from "./sources";
import {
  finishPriceRun,
  isFresh,
  latestForKey,
  latestRun,
  loadLatest,
  recordQuote,
  staleGoodsCorridors,
  startPriceRun,
} from "./store";
import type { PricePack } from "./types";

const FX_MAX_AGE = 24 * 60 * 60 * 1000;
const GOODS_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const DUTY_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

async function ensureFx(): Promise<void> {
  const current = await latestForKey("fx:USD:GHS");
  if (isFresh(current?.asOf || current?.updatedAt, FX_MAX_AGE)) return;
  try {
    await recordQuote(await fetchUsdGhs());
  } catch {
    /* keep last good rate */
  }
}

async function ensureCorridorQuotes(hsCode: string, origin: string, destination: string): Promise<void> {
  const exportKey = `goods_export:${hsCode}:${origin}:${destination}`;
  const importKey = `goods_import:${hsCode}:${origin}:${destination}`;
  const dutyKey = `duty:${hsCode}:${destination}`;
  const vatKey = `vat:${destination}`;

  const [exported, imported, duty, vat] = await Promise.all([
    latestForKey(exportKey),
    latestForKey(importKey),
    latestForKey(dutyKey),
    latestForKey(vatKey),
  ]);

  const jobs: Array<Promise<void>> = [];
  if (!isFresh(exported?.asOf || exported?.updatedAt, GOODS_MAX_AGE)) {
    jobs.push(
      fetchExportUnitValue(origin, destination, hsCode).then(async (quote) => {
        if (quote) await recordQuote(quote);
      }),
    );
  }
  if (!isFresh(imported?.asOf || imported?.updatedAt, GOODS_MAX_AGE)) {
    jobs.push(
      fetchImportUnitValue(origin, destination, hsCode).then(async (quote) => {
        if (quote) await recordQuote(quote);
      }),
    );
  }
  if (!isFresh(duty?.asOf || duty?.updatedAt, DUTY_MAX_AGE)) {
    jobs.push(recordQuote(scheduleDuty(hsCode, destination)).then(() => undefined));
  }
  if (!isFresh(vat?.asOf || vat?.updatedAt, DUTY_MAX_AGE)) {
    jobs.push(recordQuote(scheduleVat(destination)).then(() => undefined));
  }
  await Promise.all(jobs);
}

export async function readPricePack(query?: {
  hs?: string;
  origin?: string;
  destination?: string;
  volume?: string;
}): Promise<PricePack> {
  const hs = query?.hs ? parseHs(query.hs) : "";
  const origin = query?.origin || "";
  const destination = query?.destination || "";
  if (hs.length >= 2 && origin && destination && origin !== destination) {
    await ensureFx();
    await ensureCorridorQuotes(hs, origin, destination);
  }
  const [rows, run] = await Promise.all([loadLatest(), latestRun()]);
  const kg = parseShipmentKg(query?.volume || "");
  const corridor =
    hs.length >= 2 && origin && destination
      ? assembleCorridor(hs, origin, destination, kg, query?.volume || `${kg / 1000} tonnes`, rows)
      : null;
  return assemblePack(rows, run?.finishedAt || run?.startedAt || null, corridor);
}

export async function refreshReferencePrices(): Promise<{ pack: PricePack; summary: Record<string, unknown> }> {
  const run = await startPriceRun();
  const errors: string[] = [];
  const saved: string[] = [];

  try {
    saved.push(await recordQuote(await fetchUsdGhs()));
  } catch (error) {
    errors.push(`fx: ${error instanceof Error ? error.message : "failed"}`);
  }

  const queue = [
    ...REFERENCE_LANES.map((lane) => ({
      hsCode: lane.hsCode,
      origin: lane.origin,
      destination: lane.destination,
    })),
    ...(await staleGoodsCorridors(40)),
  ];
  const seen = new Set<string>();
  for (const item of queue) {
    const id = `${item.hsCode}:${item.origin}:${item.destination}`;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const exported = await fetchExportUnitValue(item.origin, item.destination, item.hsCode);
      if (exported) saved.push(await recordQuote(exported));
      else errors.push(`export ${id}: no weight`);
    } catch (error) {
      errors.push(`export ${id}: ${error instanceof Error ? error.message : "failed"}`);
    }
    try {
      const imported = await fetchImportUnitValue(item.origin, item.destination, item.hsCode);
      if (imported) saved.push(await recordQuote(imported));
      else errors.push(`import ${id}: no weight`);
    } catch (error) {
      errors.push(`import ${id}: ${error instanceof Error ? error.message : "failed"}`);
    }
    try {
      const duty = await dutyQuoteForLane(item.hsCode, item.destination);
      saved.push(await recordQuote(duty));
    } catch (error) {
      errors.push(`duty ${id}: ${error instanceof Error ? error.message : "failed"}`);
    }
    try {
      saved.push(await recordQuote(scheduleVat(item.destination)));
    } catch (error) {
      errors.push(`vat ${item.destination}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  const summary = {
    saved: saved.length,
    corridors: seen.size,
    productsCovered: "Any HS2/HS4/HS6 via on-demand cache; nightly refreshes featured + recently used corridors.",
    errors,
  };
  await finishPriceRun(run.id, errors.length && !saved.length ? "error" : "ok", summary);
  const pack = assemblePack(await loadLatest(), new Date().toISOString());
  return { pack, summary };
}

export function describeProduct(hsCode: string): string {
  return productLabel(hsCode);
}
