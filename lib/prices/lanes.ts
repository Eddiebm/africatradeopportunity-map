export type LaneSeed = {
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
  signal: string;
  docs: string[];
};

export const REFERENCE_LANES: LaneSeed[] = [
  {
    product: "0703 — Onions",
    hsCode: "0703",
    origin: "Burkina Faso",
    destination: "Ghana",
    unit: "20-tonne truck",
    shipmentKg: 20000,
    buy: 14800,
    sell: 20500,
    freight: 2100,
    border: 850,
    loss: 5,
    finance: 420,
    signal: "Strong seasonal import pattern",
    docs: ["commercial invoice", "ECOWAS proof of origin", "phytosanitary certificate", "customs declaration"],
  },
  {
    product: "0102 — Live cattle",
    hsCode: "0102",
    origin: "Burkina Faso",
    destination: "Ghana",
    unit: "25 head",
    shipmentKg: 6250,
    buy: 24500,
    sell: 33000,
    freight: 3100,
    border: 1200,
    loss: 2,
    finance: 700,
    signal: "Established livestock corridor",
    docs: ["veterinary health certificate", "movement permit", "ECOWAS origin evidence", "customs declaration"],
  },
  {
    product: "2523 — Cement",
    hsCode: "2523",
    origin: "Ghana",
    destination: "Burkina Faso",
    unit: "30-tonne truck",
    shipmentKg: 30000,
    buy: 19000,
    sell: 24900,
    freight: 2800,
    border: 700,
    loss: 1,
    finance: 480,
    signal: "Recurring construction demand",
    docs: ["commercial invoice", "ETLS certificate for approved product", "standards conformity", "transit/customs declaration"],
  },
  {
    product: "7208 — Flat-rolled steel",
    hsCode: "7208",
    origin: "Ghana",
    destination: "Burkina Faso",
    unit: "25 tonnes",
    shipmentKg: 25000,
    buy: 28500,
    sell: 36500,
    freight: 3300,
    border: 900,
    loss: 0.5,
    finance: 760,
    signal: "Material trade already recorded",
    docs: ["commercial invoice", "certificate of origin", "standards documentation", "customs declaration"],
  },
  {
    product: "0702 — Tomatoes",
    hsCode: "0702",
    origin: "Burkina Faso",
    destination: "Ghana",
    unit: "18-tonne truck",
    shipmentKg: 18000,
    buy: 11200,
    sell: 17600,
    freight: 1950,
    border: 650,
    loss: 12,
    finance: 350,
    signal: "High demand, high spoilage risk",
    docs: ["phytosanitary certificate", "commercial invoice", "agricultural origin evidence", "customs declaration"],
  },
  {
    product: "1801 — Cocoa beans",
    hsCode: "1801",
    origin: "Ghana",
    destination: "Togo",
    unit: "10 tonnes",
    shipmentKg: 10000,
    buy: 32000,
    sell: 38500,
    freight: 1600,
    border: 950,
    loss: 1,
    finance: 800,
    signal: "Regulated commodity—licence critical",
    docs: ["licensed cocoa export approval", "quality certificate", "certificate of origin", "customs declaration"],
  },
  {
    product: "2501 — Salt",
    hsCode: "2501",
    origin: "Ghana",
    destination: "Burkina Faso",
    unit: "30-tonne truck",
    shipmentKg: 30000,
    buy: 2400,
    sell: 5100,
    freight: 2800,
    border: 400,
    loss: 1,
    finance: 180,
    signal: "Recorded Ghana salt export to Burkina Faso, 2024",
    docs: ["commercial invoice", "certificate of origin", "packing list", "customs declaration"],
  },
];

export function parseHs(productOrHs: string): string {
  return productOrHs.replace(/\D/g, "").slice(0, 6);
}

export function parseShipmentKg(volume: string): number {
  const text = volume.toLowerCase();
  const tonnes = text.match(/([\d.]+)\s*-?\s*ton/);
  if (tonnes) return Math.round(Number(tonnes[1]) * 1000);
  const head = text.match(/([\d.]+)\s*head/);
  if (head) return Math.round(Number(head[1]) * 250);
  const kg = text.match(/([\d.]+)\s*kg/);
  if (kg) return Math.round(Number(kg[1]));
  return 20000;
}

export function defaultLoss(hsCode: string): number {
  const chapter = Number(hsCode.slice(0, 2));
  if (chapter >= 1 && chapter <= 8) return 8;
  if (chapter >= 9 && chapter <= 14) return 3;
  return 1;
}

export function defaultFreight(shipmentKg: number): number {
  return Math.round(shipmentKg * 0.1);
}

export function defaultDocs(hsCode: string): string[] {
  const chapter = Number(hsCode.slice(0, 2));
  const base = ["commercial invoice", "packing list", "proof of origin", "customs declaration"];
  if (chapter >= 1 && chapter <= 24) return [...base, "SPS or health permit"];
  if (chapter === 30) return [...base, "pharmacy / standards permit"];
  return [...base, "product-specific permit"];
}

export function findLane(origin: string, destination: string, productOrHs: string): LaneSeed | undefined {
  const hs = parseHs(productOrHs);
  return REFERENCE_LANES.find(
    (lane) =>
      lane.origin === origin &&
      lane.destination === destination &&
      (lane.product === productOrHs ||
        lane.hsCode === hs ||
        (hs.length > lane.hsCode.length && hs.startsWith(lane.hsCode))),
  );
}
