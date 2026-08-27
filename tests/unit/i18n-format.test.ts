// Priority 4 (docs/production-readiness.md): locale-aware
// currency/number/date formatting.
import { describe, expect, it } from "vitest";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/i18n/format";

describe("lib/i18n/format", () => {
  it("formats a currency amount with grouping and the right symbol", () => {
    expect(formatCurrency(1234567.5, "USD")).toBe("$1,234,567.50");
  });

  it("formats a non-USD currency correctly (this app supports GHS/NGN/XOF/KES/ZAR — see app/disputes/page.tsx's currency select)", () => {
    const result = formatCurrency(1000, "KES");
    expect(result).toContain("1,000");
    expect(result).toMatch(/KES|KSh/); // Intl renders KES with its actual symbol, not a literal "KES" prefix
  });

  it("falls back to a plain number + code, never throws, on an invalid currency code", () => {
    expect(() => formatCurrency(100, "NOTREAL")).not.toThrow();
    expect(formatCurrency(100, "NOTREAL")).toContain("100");
  });

  it("formats a plain number with thousands grouping", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("formats a date/time explicitly in UTC, not the server's ambient timezone", () => {
    const result = formatDateTime("2026-03-15T14:30:00.000Z");
    expect(result).toContain("2026");
    expect(result).toMatch(/UTC|GMT/); // timeZoneName: "short" must actually show
  });

  it("returns the raw input rather than throwing or showing 'Invalid Date' on unparseable input", () => {
    expect(formatDateTime("not-a-real-date")).toBe("not-a-real-date");
  });
});
