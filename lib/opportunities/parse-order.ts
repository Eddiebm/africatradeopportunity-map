import { africaCountries } from "../africa-countries";
import { hs2Catalog } from "../hs-catalog";
import { FEATURED_PRODUCTS, productLabel } from "../prices/catalog";
import type { ParsedOrder } from "./types";

const COUNTRY_NAMES = africaCountries.map(([name]) => name).sort((a, b) => b.length - a.length);

const ALIASES: Array<[RegExp, string]> = [
  [/\bivory coast\b/gi, "Côte d’Ivoire"],
  [/\bcote d['’]?ivoire\b/gi, "Côte d’Ivoire"],
  [/\bdrc\b/gi, "DR Congo"],
  [/\bcongo[- ]brazzaville\b/gi, "Republic of Congo"],
  [/\bburkina(?!\s+faso)\b/gi, "Burkina Faso"],
  [/\bsouth africa\b/gi, "South Africa"],
  [/\bequatoral guinea\b/gi, "Equatorial Guinea"],
  [/\bguinea bissau\b/gi, "Guinea-Bissau"],
  [/\bcabo verde\b|\bcape verde\b/gi, "Cabo Verde"],
];

function normalize(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  for (const [pattern, name] of ALIASES) {
    text = text.replace(pattern, name);
  }
  return text;
}

function findCountries(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const name of COUNTRY_NAMES) {
    if (lower.includes(name.toLowerCase()) && !found.includes(name)) found.push(name);
  }
  return found.filter(
    (name) => !found.some((other) => other !== name && other.toLowerCase().includes(name.toLowerCase())),
  );
}

function detectRole(text: string): ParsedOrder["role"] {
  const t = text.toLowerCase();
  if (/\b(truck|trailer|freight|lorry|backload)\b/.test(t) && /\b(available|empty|looking for load)\b/.test(t)) {
    return "freight_available";
  }
  if (/\b(selling|for sale|i have|supply of|in stock|available for sale)\b/.test(t)) return "for_sale";
  if (/\b(need|needed|wanted|looking for|buyer|buying|seeking|require|rfq)\b/.test(t)) return "wanted";
  return "wanted";
}

function detectProduct(text: string): { product: string; hsCode: string } {
  const lower = text.toLowerCase();
  const featured = FEATURED_PRODUCTS.find((row) => {
    const name = (row.split(" — ")[1] || "").toLowerCase();
    const words = name.split(/\s+/).filter((word) => word.length >= 4);
    return words.some((word) => lower.includes(word.replace(/s$/, "")));
  });
  if (featured) return { product: featured, hsCode: featured.split(" — ")[0] };

  const marked = text.match(/\bHS\s*(\d{2,6})\b/i);
  if (marked) return { product: productLabel(marked[1]), hsCode: marked[1] };

  for (const [code, name] of hs2Catalog) {
    if (name.length >= 6 && lower.includes(name.toLowerCase())) {
      return { product: `${code} — ${name}`, hsCode: code };
    }
  }
  return { product: "", hsCode: "" };
}

function detectVolume(text: string): string {
  const match =
    text.match(/(\d[\d.,]*)\s*-?\s*(tonnes?|tons?|mt|t\b|bags?|head|kg|crates?)/i) ||
    text.match(/\b(\d[\d.,]*)\s*(20[-\s]?tonne)/i);
  if (!match) return "";
  return `${match[1]} ${match[2]}`.replace(/\s+/g, " ");
}

function detectPrice(text: string): string {
  const match = text.match(/(?:usd|us\$|\$|ghs|cfa|xof|ngn|kes)\s*[\d][\d,.]*(?:\s*\/\s*(?:t|ton|tonne|kg|bag|head))?/i);
  return match ? match[0].replace(/\s+/g, " ") : "";
}

function detectContact(text: string): string {
  const phone = text.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/);
  const mail = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (phone?.[0] || mail?.[0] || "").replace(/\s+/g, " ").trim();
}

function route(text: string, countries: string[], home: string, role: ParsedOrder["role"]): { origin: string; destination: string } {
  const fromTo = text.match(/from\s+([^,]+?)\s+to\s+([^,.]+)/i);
  if (fromTo) {
    const originHits = findCountries(fromTo[1]);
    const destHits = findCountries(fromTo[2]);
    if (originHits[0] && destHits[0]) return { origin: originHits[0], destination: destHits[0] };
  }
  const arrow = text.match(/([A-Za-zÀ-ÿ’' -]+)\s*(?:→|->| to )\s*([A-Za-zÀ-ÿ’' -]+)/i);
  if (arrow) {
    const originHits = findCountries(arrow[1]);
    const destHits = findCountries(arrow[2]);
    if (originHits[0] && destHits[0]) return { origin: originHits[0], destination: destHits[0] };
  }
  if (role === "wanted") {
    return { origin: countries.find((name) => name !== home) || countries[0] || home, destination: home };
  }
  if (role === "for_sale") {
    return { origin: home, destination: countries.find((name) => name !== home) || countries[0] || home };
  }
  return { origin: home, destination: countries.find((name) => name !== home) || home };
}

export function parseOrderText(raw: string, home: string): ParsedOrder {
  const notes: string[] = [];
  const text = normalize(raw);
  if (text.length < 8) {
    return {
      role: "wanted",
      product: "",
      hsCode: "",
      origin: home,
      destination: home,
      volume: "",
      targetPrice: "",
      contact: "",
      confidence: 0,
      notes: ["Paste the full WhatsApp text — product, volume, and the two countries."],
    };
  }

  const role = detectRole(text);
  const { product, hsCode } = detectProduct(text);
  const countries = findCountries(text);
  const { origin, destination } = route(text, countries, home, role);
  const volume = detectVolume(text);
  const targetPrice = detectPrice(text);
  const contact = detectContact(text);

  if (!product) notes.push("Name the goods (onions, cattle, cement, or an HS code).");
  if (!volume) notes.push("Add a quantity (tonnes, bags, or head).");
  if (!contact) notes.push("A phone or email stays private until verification.");
  if (origin === destination) notes.push("Say the origin and destination countries.");

  let confidence = 40;
  if (product) confidence += 20;
  if (volume) confidence += 15;
  if (origin !== destination) confidence += 15;
  if (contact) confidence += 10;
  if (targetPrice) confidence += 5;

  return {
    role,
    product: product || text.slice(0, 80),
    hsCode,
    origin,
    destination,
    volume: volume || "unspecified",
    targetPrice,
    contact,
    confidence: Math.min(95, confidence),
    notes,
  };
}
