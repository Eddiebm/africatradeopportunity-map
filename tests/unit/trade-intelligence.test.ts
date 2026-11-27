// lib/trade-intelligence.ts against stubbed UN Comtrade, World Bank and
// TimesFM responses. Pins the behaviour that matters after UN Comtrade's
// public preview API changed: one period per request, no aggregateBy,
// retry on HTTP 429, and a TimesFM forecast that never replaces the
// heuristic outlook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { intelligenceWatchlist, sourceRecords, tradeIntelligenceSnapshots } from "../../db/schema";
import { getImportIntelligence } from "../../lib/trade-intelligence";

const year = new Date().getUTCFullYear();

type Stub = {
  reportedYears: number[];
  timesfmStatus?: number;
  rateLimitOnce?: boolean;
};

function installFetch(stub: Stub) {
  const calls: string[] = [];
  const timesfmBodies: Array<{ values: Array<number | null>; horizon: number }> = [];
  let limited = false;
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("comtradeapi.un.org")) {
      const query = new URL(url).searchParams;
      if (query.has("aggregateBy") || (query.get("period") || "").includes(",")) {
        return Response.json({ error: "Invalid parameter value" }, { status: 400 });
      }
      if (stub.rateLimitOnce && !limited && query.get("period") === String(year - 1)) {
        limited = true;
        return new Response('{ "statusCode": 429, "message": "Rate limit is exceeded. Try again in 1 seconds." }', { status: 429 });
      }
      const period = query.get("period") || "";
      if (query.get("partnerCode") === null) {
        return Response.json({ data: [{ period, partnerCode: 0, partnerDesc: "World", primaryValue: 500, netWgt: 1 }] });
      }
      const reported = period.length === 4 && stub.reportedYears.includes(+period);
      if (!reported) return Response.json({ data: [] });
      const value = 1_000_000 + (+period - 2000) * 100_000;
      return Response.json({ data: [{ period, primaryValue: value, netWgt: 10, cmdDesc: "Rice", isReported: true }] });
    }
    if (url.includes("api.worldbank.org")) return Response.json([{}, [{ date: String(year - 1), value: 2 }]]);
    if (url.includes("/api/forecast")) {
      const body = JSON.parse(init?.body as string) as { values: Array<number | null>; horizon: number };
      timesfmBodies.push(body);
      if (stub.timesfmStatus && stub.timesfmStatus !== 200) return new Response("down", { status: stub.timesfmStatus });
      const point = Array.from({ length: body.horizon }, (_, i) => 2_000_000 + i * 100_000);
      return Response.json({ point, quantiles: { "0.1": point.map((p) => p * 0.8), "0.9": point.map((p) => p * 1.25) }, model: "timesfm-test" });
    }
    return new Response("unexpected", { status: 500 });
  };
  vi.stubGlobal("fetch", vi.fn(handler));
  return { calls, timesfmBodies };
}

const reportedRange = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("getImportIntelligence", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(tradeIntelligenceSnapshots);
    await db.delete(sourceRecords);
    await db.delete(intelligenceWatchlist);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests one Comtrade period at a time and adds a TimesFM forecast next to the heuristic outlook", async () => {
    const { calls, timesfmBodies } = installFetch({ reportedYears: reportedRange(year - 12, year - 1) });
    const intel = await getImportIntelligence("Kenya", "1006", { force: true });

    const comtrade = calls.filter((u) => u.includes("comtradeapi.un.org"));
    expect(comtrade.every((u) => !u.includes("aggregateBy") && !(new URL(u).searchParams.get("period") || "").includes(","))).toBe(true);
    expect(intel.annual).toHaveLength(6);
    expect(intel.annual.at(-1)).toMatchObject({ period: String(year - 1), status: "official" });
    expect(intel.outlook.value).toBeGreaterThan(0);

    expect(intel.timesfm?.status).toBe("ok");
    if (intel.timesfm?.status !== "ok") return;
    expect(intel.timesfm.nextYear).toBe(year + 1);
    expect(intel.timesfm.lastObservedYear).toBe(year - 1);
    expect(intel.timesfm.observations).toBe(12);
    expect(intel.timesfm.low).toBeLessThan(intel.timesfm.value);
    expect(intel.timesfm.high).toBeGreaterThan(intel.timesfm.value);
    expect(timesfmBodies).toHaveLength(1);
    expect(timesfmBodies[0].horizon).toBe(2);

    const forecastRows = await getDb().select().from(sourceRecords);
    const timesfmRow = forecastRows.find((r) => r.metric === "forecast_import_value_usd_timesfm");
    expect(timesfmRow).toMatchObject({ evidenceCategory: "forecast", period: String(year + 1), confidence: null });
    expect(forecastRows.some((r) => r.metric === "forecast_import_value_usd")).toBe(true);
  });

  it("retries a rate-limited Comtrade period instead of dropping it", async () => {
    installFetch({ reportedYears: reportedRange(year - 12, year - 1), rateLimitOnce: true });
    const intel = await getImportIntelligence("Kenya", "1006", { force: true });
    expect(intel.annual.at(-1)?.status).toBe("official");
    expect(intel.warnings.some((w) => w.includes("could not be retrieved"))).toBe(false);
  }, 15_000);

  it("keeps the heuristic outlook and says why when history is too short for TimesFM", async () => {
    const { timesfmBodies } = installFetch({ reportedYears: reportedRange(year - 5, year - 1) });
    const intel = await getImportIntelligence("Kenya", "1006", { force: true });
    expect(intel.outlook.value).toBeGreaterThan(0);
    expect(intel.timesfm).toEqual({ status: "insufficient-history", observations: 5, needed: 8 });
    expect(timesfmBodies).toHaveLength(0);
  });

  it("still answers when the TimesFM service is down, and does not pin that failure for a day", async () => {
    installFetch({ reportedYears: reportedRange(year - 12, year - 1), timesfmStatus: 500 });
    const intel = await getImportIntelligence("Kenya", "1006", { force: true });
    expect(intel.outlook.value).toBeGreaterThan(0);
    expect(intel.timesfm?.status).toBe("unavailable");

    const fresh = await getImportIntelligence("Kenya", "1006");
    expect(fresh.cache.status).toBe("cached");

    const db = getDb();
    const [snap] = await db.select().from(tradeIntelligenceSnapshots);
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await db.update(tradeIntelligenceSnapshots).set({ retrievedAt: old });
    expect(snap).toBeDefined();
    installFetch({ reportedYears: reportedRange(year - 12, year - 1) });
    const retried = await getImportIntelligence("Kenya", "1006");
    expect(retried.cache.status).toBe("live");
    expect(retried.timesfm?.status).toBe("ok");
  });

  it("marks annual periods that could not be fetched instead of calling them zero", async () => {
    const handler = installFetch({ reportedYears: reportedRange(year - 12, year - 1) });
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes(`period=${year - 3}&`) && String(input).includes("partnerCode=0")) return new Response("boom", { status: 500 });
        return original(input, init);
      }),
    );
    const intel = await getImportIntelligence("Kenya", "1006", { force: true });
    expect(handler.calls.length).toBeGreaterThan(0);
    expect(intel.annual.find((a) => a.period === String(year - 3))?.status).toBe("fetch-failed");
    expect(intel.warnings.some((w) => w.includes("1 annual period"))).toBe(true);
    const rows = await getDb().select().from(sourceRecords);
    expect(rows.some((r) => r.metric === "import_value_usd" && r.period === String(year - 3))).toBe(false);
  });
});
