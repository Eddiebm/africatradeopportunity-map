// lib/timesfm.ts: the TimesFM service client and the annual-series builder.
// The service itself is stubbed — these tests pin the request/response
// contract and, more importantly, the honest-failure behaviour (never a
// fabricated forecast when the model or the history isn't there).
import { describe, expect, it, vi } from "vitest";
import { buildAnnualSeries, forecastAnnualImports, forecastSeries, MIN_OBSERVATIONS } from "../../lib/timesfm";

const config = { url: "https://timesfm.test", token: "secret-token" };

function point(period: number, value: number, status = "official") {
  return { period: String(period), value, status };
}

function history(years: number[], missing: number[] = []) {
  return years.map((y) => (missing.includes(y) ? point(y, 0, "not-reported") : point(y, 100 + (y - years[0]) * 10)));
}

function serviceResponse(horizon: number, base = 200) {
  const point = Array.from({ length: horizon }, (_, i) => base + i * 10);
  return Response.json({
    point,
    quantiles: { "0.1": point.map((p) => p * 0.8), "0.5": point, "0.9": point.map((p) => p * 1.3) },
    context_used: 10,
    model: "google/timesfm-2.5-200m-pytorch",
  });
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("buildAnnualSeries", () => {
  it("spans first to last reported year and leaves gaps null instead of zero", () => {
    const series = buildAnnualSeries([point(2015, 0, "not-reported"), point(2016, 50), point(2017, 0, "not-reported"), point(2018, 70), point(2019, 0, "fetch-failed")]);
    expect(series).toEqual({ values: [50, null, 70], firstYear: 2016, lastYear: 2018, observations: 2 });
  });

  it("returns null when nothing was reported", () => {
    expect(buildAnnualSeries([point(2020, 0, "not-reported")])).toBeNull();
  });
});

describe("forecastSeries", () => {
  it("sends a bearer token and returns the 10th/90th percentile band", async () => {
    const fetcher = vi.fn(async () => serviceResponse(2));
    const result = await forecastSeries([1, 2, 3], 2, config, fetcher as unknown as typeof fetch);
    expect(result.point).toEqual([200, 210]);
    expect(result.low).toEqual([160, 168]);
    expect(result.high).toEqual([260, 273]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://timesfm.test/api/forecast");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string)).toEqual({ values: [1, 2, 3], horizon: 2 });
  });

  it("retries while the container is still loading the model", async () => {
    const wait = vi.fn(async () => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("loading", { status: 503 }))
      .mockResolvedValueOnce(serviceResponse(1));
    const result = await forecastSeries([1, 2, 3], 1, config, fetcher as unknown as typeof fetch, wait);
    expect(result.point).toEqual([200]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("rejects a response whose shape does not match the request", async () => {
    const fetcher = vi.fn(async () => serviceResponse(3));
    await expect(forecastSeries([1, 2, 3], 1, config, fetcher as unknown as typeof fetch)).rejects.toThrow(/unexpected response/);
  });
});

describe("forecastAnnualImports", () => {
  it("is a no-op without configuration", async () => {
    const fetcher = vi.fn();
    expect(await forecastAnnualImports(history(range(2012, 2025)), 2027, null, fetcher as unknown as typeof fetch)).toEqual({ status: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses short histories without calling the service", async () => {
    const fetcher = vi.fn();
    const outlook = await forecastAnnualImports(history(range(2020, 2025)), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook).toEqual({ status: "insufficient-history", observations: 6, needed: MIN_OBSERVATIONS });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forecasts through the target year and reports the last forecast step", async () => {
    const fetcher = vi.fn(async () => serviceResponse(2));
    const outlook = await forecastAnnualImports(history(range(2014, 2025), [2016]), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook.status).toBe("ok");
    if (outlook.status !== "ok") return;
    expect(outlook.nextYear).toBe(2027);
    expect(outlook.lastObservedYear).toBe(2025);
    expect(outlook.observations).toBe(11);
    expect(outlook.path.map((p) => p.year)).toEqual([2026, 2027]);
    expect(outlook.value).toBe(210);
    expect(outlook.low).toBeCloseTo(168);
    expect(outlook.high).toBeCloseTo(273);
    const body = JSON.parse(((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string));
    expect(body.horizon).toBe(2);
    expect(body.values).toHaveLength(12);
    expect(body.values[2]).toBeNull();
  });

  it("extends the horizon when the latest year is not reported yet", async () => {
    const fetcher = vi.fn(async () => serviceResponse(3));
    const outlook = await forecastAnnualImports(history(range(2013, 2025), [2025]), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook.status).toBe("ok");
    if (outlook.status === "ok") expect(outlook.lastObservedYear).toBe(2024);
    expect(JSON.parse(((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).horizon).toBe(3);
  });

  it("gives up rather than guess when the last report is too old", async () => {
    const fetcher = vi.fn();
    const outlook = await forecastAnnualImports(history(range(2005, 2015)), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook.status).toBe("insufficient-history");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("clamps negative model output to zero", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ point: [-5, -1], quantiles: { "0.1": [-9, -8], "0.9": [1, 2] }, model: "m" }),
    );
    const outlook = await forecastAnnualImports(history(range(2014, 2025)), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook.status === "ok" && [outlook.value, outlook.low, outlook.high]).toEqual([0, 0, 2]);
  });

  it("reports unavailable instead of throwing when the service fails", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    const outlook = await forecastAnnualImports(history(range(2014, 2025)), 2027, config, fetcher as unknown as typeof fetch);
    expect(outlook).toEqual({ status: "unavailable", reason: "TimesFM service returned 500" });
  });
});
