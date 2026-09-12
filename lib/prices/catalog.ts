import { hs2Catalog } from "../hs-catalog";

export const FEATURED_PRODUCTS = [
  "0702 — Tomatoes",
  "0703 — Onions",
  "1006 — Rice",
  "1207 — Oilseeds",
  "1509 — Vegetable oils",
  "1801 — Cocoa beans",
  "2501 — Salt",
  "2523 — Cement",
  "2710 — Refined petroleum",
  "3004 — Medicines",
  "7208 — Flat-rolled steel",
  "8701 — Tractors",
  "0102 — Live cattle",
];

export const PRODUCT_OPTIONS = [
  ...FEATURED_PRODUCTS,
  ...hs2Catalog.map(([code, name]) => `${code} — ${name}`),
];

export function productLabel(hsCode: string, fallback = ""): string {
  const featured = FEATURED_PRODUCTS.find((row) => {
    const code = row.split(" — ")[0];
    return code === hsCode || (hsCode.length > code.length && hsCode.startsWith(code));
  });
  if (featured) {
    const code = featured.split(" — ")[0];
    return code === hsCode ? featured : `${hsCode} — ${featured.split(" — ")[1]}`;
  }
  const hs2 = hsCode.slice(0, 2).padStart(2, "0");
  const chapter = hs2Catalog.find(([code]) => code === hs2);
  if (chapter) return `${hsCode} — ${chapter[1]}`;
  return fallback || `HS ${hsCode}`;
}

export function resolveHs(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 6);
  if (digits.length >= 2) return digits;
  const query = input.trim().toLowerCase();
  if (query.length < 3) return "";
  const hit = PRODUCT_OPTIONS.find((row) => row.toLowerCase().includes(query));
  return hit?.match(/^\d{2,6}/)?.[0] || "";
}

export function productDisplayName(product: string): string {
  return product.includes(" — ") ? product.split(" — ")[1] : product || "Shipment";
}
