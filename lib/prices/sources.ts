import { comtradeCodeByName } from "../africa-countries";
import type { PriceQuote } from "./types";
import { CET_SOURCE, cetDuty, destinationVat, isEcowas } from "./tariffs";

const COMTRADE_YEARS = ["2024", "2023", "2022"];

type ComtradeRow = {
  period?: string | number;
  primaryValue?: number;
  netWgt?: number;
  cmdDesc?: string;
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 429) throw new Error("RATE_LIMIT");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchUsdGhs(): Promise<PriceQuote> {
  const url = "https://open.er-api.com/v6/latest/USD";
  const body = (await fetchJson(url)) as {
    result?: string;
    time_last_update_utc?: string;
    time_last_update_unix?: number;
    rates?: Record<string, number>;
  };
  const ghs = body.rates?.GHS;
  if (!ghs || body.result !== "success") {
    throw new Error("USD/GHS rate missing");
  }
  const asOf = body.time_last_update_utc
    ? new Date(body.time_last_update_utc).toISOString()
    : new Date().toISOString();
  return {
    instrument: "fx_ghs_per_usd",
    value: ghs,
    unit: "GHS_per_USD",
    currency: "GHS",
    source: "open.er-api.com",
    period: asOf.slice(0, 10),
    url,
    notes: "Mid-market USD/GHS. Not a Bank of Ghana dealing rate and not a bank quote.",
    confidence: "official",
    asOf,
    raw: { time_last_update_utc: body.time_last_update_utc },
  };
}

function comtradeUrl(year: string, reporter: string, partner: string, flow: "X" | "M", hs: string): string {
  return `https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=${year}&reporterCode=${reporter}&partnerCode=${partner}&flowCode=${flow}&cmdCode=${hs}&maxRecords=50`;
}

async function comtradeUnitValue(
  origin: string,
  destination: string,
  hsCode: string,
  flow: "X" | "M",
): Promise<PriceQuote | null> {
  const reporterName = flow === "X" ? origin : destination;
  const partnerName = flow === "X" ? destination : origin;
  const reporter = comtradeCodeByName[reporterName];
  const partner = comtradeCodeByName[partnerName];
  if (!reporter || !partner) return null;

  for (const year of COMTRADE_YEARS) {
    const url = comtradeUrl(year, reporter, partner, flow, hsCode);
    try {
      const body = (await fetchJson(url)) as { data?: ComtradeRow[] };
      const rows = body.data || [];
      const value = rows.reduce((sum, row) => sum + (row.primaryValue || 0), 0);
      const kg = rows.reduce((sum, row) => sum + (row.netWgt || 0), 0);
      if (value <= 0 || kg <= 0) continue;
      const perKg = value / kg;
      const instrument = flow === "X" ? "goods_export_usd_per_kg" : "goods_import_usd_per_kg";
      return {
        instrument,
        value: perKg,
        unit: "USD_per_kg",
        currency: "USD",
        source: "UN Comtrade preview",
        period: String(rows[0]?.period || year),
        url,
        notes:
          flow === "X"
            ? `Implied FOB unit value from ${origin} exports to ${destination}, ${year}. Not a live offer.`
            : `Implied CIF-ish unit value from ${destination} imports of ${origin} origin, ${year}. Not a live bid.`,
        confidence: "derived",
        hsCode,
        origin,
        destination,
        asOf: `${year}-12-31T00:00:00.000Z`,
        raw: { records: rows.length, value, kg },
      };
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMIT") return null;
      continue;
    }
  }
  return null;
}

export async function fetchExportUnitValue(origin: string, destination: string, hsCode: string) {
  return comtradeUnitValue(origin, destination, hsCode, "X");
}

export async function fetchImportUnitValue(origin: string, destination: string, hsCode: string) {
  return comtradeUnitValue(origin, destination, hsCode, "M");
}

export function scheduleDuty(hsCode: string, destination: string): PriceQuote {
  const row = cetDuty(hsCode);
  const ecowas = isEcowas(destination);
  return {
    instrument: "mfn_duty_pct",
    value: row.dutyPct,
    unit: "percent",
    currency: "",
    source: CET_SOURCE.name,
    period: CET_SOURCE.asOf.slice(0, 4),
    url: CET_SOURCE.url,
    notes: ecowas
      ? `ECOWAS CET ${row.dutyPct}% (${row.band}) into ${destination}. Confirm HS6; ETLS origin can reduce this.`
      : `Indicative ${row.dutyPct}% chapter band for ${destination} (not the national applied rate). Confirm HS6 with a licensed broker.`,
    confidence: "schedule",
    hsCode,
    destination,
    asOf: `${CET_SOURCE.asOf}T00:00:00.000Z`,
  };
}

export function scheduleVat(destination: string): PriceQuote {
  const vat = destinationVat(destination);
  return {
    instrument: "vat_pct",
    value: vat.pct,
    unit: "percent",
    currency: "",
    source: vat.label,
    period: "2024",
    url: vat.url,
    notes: vat.label,
    confidence: vat.pct > 0 ? "schedule" : "fallback",
    destination,
    asOf: "2024-01-01T00:00:00.000Z",
  };
}

export async function fetchWitsDuty(hsCode: string, destinationIso3: string): Promise<PriceQuote | null> {
  const url = `https://wits.worldbank.org/API/V1/SDMX/V21/rest/data/DF_WITS_Tariff_TRAINS/A.${destinationIso3}.WLD.${hsCode}?startPeriod=2022&endPeriod=2024&format=jsondata`;
  try {
    const body = (await fetchJson(url)) as {
      dataSets?: Array<{ series?: Record<string, { observations?: Record<string, number[]> }> }>;
    };
    const series = body.dataSets?.[0]?.series;
    if (!series) return null;
    const values: number[] = [];
    for (const item of Object.values(series)) {
      for (const obs of Object.values(item.observations || {})) {
        if (typeof obs?.[0] === "number") values.push(obs[0]);
      }
    }
    if (!values.length) return null;
    const latest = values[values.length - 1];
    return {
      instrument: "mfn_duty_pct",
      value: latest,
      unit: "percent",
      currency: "",
      source: "WITS / UNCTAD TRAINS",
      period: "2022-2024",
      url,
      notes: `MFN simple average returned by WITS for HS ${hsCode}. Confirm the national applied rate before a shipment.`,
      confidence: "official",
      hsCode,
      asOf: new Date().toISOString(),
      raw: { sample: values.slice(-3) },
    };
  } catch {
    return null;
  }
}
