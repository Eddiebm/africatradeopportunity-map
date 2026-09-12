import { iso3ByName } from "../africa-countries";
import { productLabel } from "./catalog";
import {
  REFERENCE_LANES,
  defaultDocs,
  defaultFreight,
  defaultLoss,
  findLane,
  type LaneSeed,
} from "./lanes";
import { fetchWitsDuty, scheduleDuty, scheduleVat } from "./sources";
import { screeningDuty } from "./tariffs";
import type { LaneEconomics, LaneSourceLine, PricePack } from "./types";

export type LatestRow = {
  key: string;
  instrument: string;
  hsCode: string;
  origin: string;
  destination: string;
  value: number;
  unit: string;
  source: string;
  period: string;
  url: string;
  notes: string;
  confidence: string;
  asOf: string;
};

const FX_SPREAD = 0.02;

function sourceLine(
  line: string,
  row: Pick<LatestRow, "source" | "asOf" | "url" | "confidence"> | undefined,
  fallback: LaneSourceLine,
): LaneSourceLine {
  if (!row) return fallback;
  return {
    line,
    label: row.source,
    asOf: row.asOf.slice(0, 10),
    url: row.url,
    status: (row.confidence as LaneSourceLine["status"]) || "official",
  };
}

function findRow(rows: LatestRow[], key: string): LatestRow | undefined {
  return rows.find((row) => row.key === key);
}

function roundMoney(value: number): number {
  return Math.round(value);
}

export function assembleLane(seed: LaneSeed, rows: LatestRow[]): LaneEconomics {
  return assembleAny(
    {
      product: seed.product,
      hsCode: seed.hsCode,
      origin: seed.origin,
      destination: seed.destination,
      unit: seed.unit,
      shipmentKg: seed.shipmentKg,
      fallbackBuy: seed.buy,
      fallbackSell: seed.sell,
      fallbackFreight: seed.freight,
      fallbackBorder: seed.border,
      fallbackFinance: seed.finance,
      loss: seed.loss,
      docs: seed.docs,
      signal: seed.signal,
      allowFallbackGoods: true,
    },
    rows,
  );
}

export function assembleCorridor(
  hsCode: string,
  origin: string,
  destination: string,
  shipmentKg: number,
  unit: string,
  rows: LatestRow[],
): LaneEconomics {
  const featured = findLane(origin, destination, hsCode);
  if (featured) {
    return assembleLane({ ...featured, shipmentKg, unit }, rows);
  }
  return assembleAny(
    {
      product: productLabel(hsCode),
      hsCode,
      origin,
      destination,
      unit,
      shipmentKg,
      fallbackBuy: 0,
      fallbackSell: 0,
      fallbackFreight: defaultFreight(shipmentKg),
      fallbackBorder: 0,
      fallbackFinance: 0,
      loss: defaultLoss(hsCode),
      docs: defaultDocs(hsCode),
      signal: "Any HS chapter can be screened. Official unit values appear when Comtrade reports weight.",
      allowFallbackGoods: false,
    },
    rows,
  );
}

function plausiblePerKg(hsCode: string, usdPerKg: number): boolean {
  if (!Number.isFinite(usdPerKg) || usdPerKg <= 0) return false;
  const chapter = Number(hsCode.slice(0, 2));
  if (chapter >= 1 && chapter <= 24) return usdPerKg >= 0.08 && usdPerKg <= 25;
  if (chapter >= 72 && chapter <= 83) return usdPerKg >= 0.3 && usdPerKg <= 20;
  return usdPerKg >= 0.05 && usdPerKg <= 80;
}

function inBand(derived: number, fallback: number): boolean {
  if (!fallback) return true;
  const ratio = derived / fallback;
  return ratio >= 0.45 && ratio <= 2.2;
}

function assembleAny(
  seed: {
    product: string;
    hsCode: string;
    origin: string;
    destination: string;
    unit: string;
    shipmentKg: number;
    fallbackBuy: number;
    fallbackSell: number;
    fallbackFreight: number;
    fallbackBorder: number;
    fallbackFinance: number;
    loss: number;
    docs: string[];
    signal: string;
    allowFallbackGoods: boolean;
  },
  rows: LatestRow[],
): LaneEconomics {
  const exportRow = findRow(rows, `goods_export:${seed.hsCode}:${seed.origin}:${seed.destination}`);
  const importRow = findRow(rows, `goods_import:${seed.hsCode}:${seed.origin}:${seed.destination}`);
  const vatRow = findRow(rows, `vat:${seed.destination}`);
  const fxRow = findRow(rows, "fx:USD:GHS");

  const derivedBuy = exportRow ? roundMoney(exportRow.value * seed.shipmentKg) : 0;
  const useDerivedBuy = Boolean(
    derivedBuy &&
      exportRow &&
      plausiblePerKg(seed.hsCode, exportRow.value) &&
      inBand(derivedBuy, seed.fallbackBuy),
  );
  const buy = useDerivedBuy ? derivedBuy : seed.allowFallbackGoods ? seed.fallbackBuy : 0;
  const sell = seed.allowFallbackGoods ? seed.fallbackSell : 0;
  const freight = seed.fallbackFreight;
  const duty = screeningDuty(seed.hsCode, seed.origin, seed.destination);
  const dutyPct = duty.dutyPct;
  const vatPct = vatRow?.value ?? scheduleVat(seed.destination).value;
  const dutyAmount = buy * (dutyPct / 100);
  const vatAmount = (buy + freight + dutyAmount) * (vatPct / 100);
  const border = buy ? roundMoney(dutyAmount + vatAmount) : seed.fallbackBorder;
  const finance = fxRow && buy ? roundMoney(buy * FX_SPREAD) : seed.fallbackFinance;
  const goodsStatus: LaneEconomics["goodsStatus"] = !buy && !sell
    ? "missing"
    : useDerivedBuy && seed.allowFallbackGoods
      ? "mixed"
      : useDerivedBuy
        ? "derived"
        : seed.allowFallbackGoods
          ? "fallback"
          : "missing";

  const cifNote = importRow && plausiblePerKg(seed.hsCode, importRow.value)
    ? `Destination import UV $${importRow.value.toFixed(2)}/kg is CIF-ish, not a wholesale bid.`
    : "No usable destination import unit value. Do not treat Comtrade CIF as a selling price.";

  const sources: LaneSourceLine[] = [
    sourceLine("Supplier cost", useDerivedBuy ? exportRow : undefined, {
      line: "Supplier cost",
      label: seed.allowFallbackGoods
        ? "Fallback screening figure — Comtrade FOB unused or out of band"
        : "No official unit value for this corridor yet",
      asOf: "",
      url: "https://comtradeplus.un.org/",
      status: "fallback",
    }),
    {
      line: "Buyer revenue",
      label: seed.allowFallbackGoods
        ? `Destination market screen, not Comtrade CIF. ${cifNote}`
        : cifNote,
      asOf: "",
      url: "https://comtradeplus.un.org/",
      status: "fallback",
    },
    {
      line: "Freight & handling",
      label: "Not from a live freight API. Edit with a trucker quote.",
      asOf: "",
      url: "",
      status: "fallback",
    },
    {
      line: "Duty, VAT & border",
      label: `${dutyPct}% duty (${duty.band}) + ${vatPct}% VAT on goods+freight+duty`,
      asOf: vatRow?.asOf.slice(0, 10) || "2024-01-01",
      url: vatRow?.url || "https://www.ecowas.int/",
      status: "schedule",
    },
    sourceLine("Finance & FX", fxRow, {
      line: "Finance & FX",
      label: fxRow
        ? `USD/GHS ${fxRow.value.toFixed(2)}. Finance line is an assumed 2% spread, not a bank quote.`
        : "Assumed 2% of goods value. Not a bank quote.",
      asOf: fxRow?.asOf.slice(0, 10) || "",
      url: fxRow?.url || "",
      status: fxRow ? "official" : "fallback",
    }),
  ];

  return {
    product: seed.product,
    hsCode: seed.hsCode,
    origin: seed.origin,
    destination: seed.destination,
    unit: seed.unit,
    shipmentKg: seed.shipmentKg,
    buy,
    sell,
    freight,
    border,
    loss: seed.loss,
    finance,
    ghsPerUsd: fxRow?.value ?? null,
    dutyPct,
    vatPct,
    sources,
    docs: seed.docs,
    signal: seed.signal,
    goodsStatus,
  };
}

export function assemblePack(
  rows: LatestRow[],
  refreshedAt: string | null,
  corridor: LaneEconomics | null = null,
): PricePack {
  const fxRow = findRow(rows, "fx:USD:GHS");
  return {
    refreshedAt,
    fx: fxRow
      ? { ghsPerUsd: fxRow.value, asOf: fxRow.asOf, source: fxRow.source, url: fxRow.url }
      : null,
    lanes: REFERENCE_LANES.map((seed) => assembleLane(seed, rows)),
    corridor,
    disclaimer:
      "Reference prices, not an offer. A quote is only binding when a verified counterparty submits it.",
  };
}

export async function dutyQuoteForLane(hsCode: string, destination: string) {
  const iso3 = iso3ByName[destination] || "";
  const wits = iso3 ? await fetchWitsDuty(hsCode, iso3) : null;
  return wits ?? scheduleDuty(hsCode, destination);
}
