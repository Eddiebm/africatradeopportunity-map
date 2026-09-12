export type PriceInstrument =
  | "fx_ghs_per_usd"
  | "goods_export_usd_per_kg"
  | "goods_import_usd_per_kg"
  | "mfn_duty_pct"
  | "vat_pct";

export type PriceConfidence = "official" | "derived" | "schedule" | "fallback";

export type PriceQuote = {
  instrument: PriceInstrument;
  value: number;
  unit: string;
  currency: string;
  source: string;
  period: string;
  url: string;
  notes: string;
  confidence: PriceConfidence;
  hsCode?: string;
  origin?: string;
  destination?: string;
  asOf: string;
  raw?: unknown;
};

export type LaneSourceLine = {
  line: string;
  label: string;
  asOf: string;
  url: string;
  status: PriceConfidence;
};

export type LaneEconomics = {
  product: string;
  hsCode: string;
  origin: string;
  destination: string;
  unit: string;
  shipmentKg: number;
  buy: number;
  sell: number;
  freight: number;
  border: number;
  loss: number;
  finance: number;
  ghsPerUsd: number | null;
  dutyPct: number | null;
  vatPct: number | null;
  sources: LaneSourceLine[];
  docs: string[];
  signal: string;
  goodsStatus: "derived" | "missing" | "fallback" | "mixed";
};

export type PricePack = {
  refreshedAt: string | null;
  fx: { ghsPerUsd: number; asOf: string; source: string; url: string } | null;
  lanes: LaneEconomics[];
  corridor: LaneEconomics | null;
  disclaimer: string;
};
