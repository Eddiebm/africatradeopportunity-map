// Client for the TimesFM forecasting service (Google Research's zero-shot
// time-series foundation model, run as a separate Worker/container — see
// docs/DEPLOYMENT.md). It is used by lib/trade-intelligence.ts as a
// statistical forecast that sits NEXT TO the heuristic outlook, never in
// place of it: the heuristic keeps working when the service is unset,
// cold, or the history is too short for the model to say anything useful.
import { env } from "cloudflare:workers";

export type TimesfmConfig = { url: string; token: string };

export type SeriesForecast = { point: number[]; low: number[]; high: number[]; model: string };

export type AnnualPoint = { period: string; value: number; status: string };

export type TimesfmOutlook =
  | {
      status: "ok";
      model: string;
      nextYear: number;
      value: number;
      low: number;
      high: number;
      /** Change of `value` against the last reported full year. */
      growthRate: number;
      lastObservedYear: number;
      observations: number;
      path: Array<{ year: number; value: number; low: number; high: number }>;
    }
  | { status: "not-configured" }
  | { status: "insufficient-history"; observations: number; needed: number }
  | { status: "unavailable"; reason: string };

/** The service refuses series with fewer finite points than this. */
export const MIN_OBSERVATIONS = 8;
/** Gaps longer than this between the last report and next year are guesses, not forecasts. */
export const MAX_STEPS_AHEAD = 4;

const NOT_REPORTED = new Set(["not-reported", "fetch-failed"]);
const COLD_START_RETRIES = 2;
const COLD_START_WAIT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

export function readTimesfmConfig(): TimesfmConfig | null {
  const url = (env.TIMESFM_URL || "").trim().replace(/\/+$/, "");
  const token = (env.TIMESFM_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Posts one series to the service. Throws on any failure; callers decide
 * whether that is fatal. A 503 means the container is still loading the
 * model after a cold start, which is retried a couple of times. */
export async function forecastSeries(
  values: Array<number | null>,
  horizon: number,
  config: TimesfmConfig,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<SeriesForecast> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(`${config.url}/api/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ values, horizon }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 503 && attempt < COLD_START_RETRIES) {
      await wait(COLD_START_WAIT_MS);
      continue;
    }
    if (!response.ok) throw new Error(`TimesFM service returned ${response.status}`);
    const body = (await response.json()) as { point?: number[]; quantiles?: Record<string, number[]>; model?: string };
    const low = body.quantiles?.["0.1"];
    const high = body.quantiles?.["0.9"];
    if (!body.point || !low || !high || body.point.length !== horizon || low.length !== horizon || high.length !== horizon) {
      throw new Error("TimesFM service returned an unexpected response");
    }
    return { point: body.point, low, high, model: body.model || "timesfm" };
  }
}

/** Turns reported annual import values into a series the model can use:
 * starts at the first reported year, ends at the last, and leaves `null`
 * for years inside that span with no official figure (never zero — a
 * missing report is not a measurement of zero imports). */
export function buildAnnualSeries(history: AnnualPoint[]): { values: Array<number | null>; firstYear: number; lastYear: number; observations: number } | null {
  const reported = history.filter((h) => !NOT_REPORTED.has(h.status) && h.value > 0);
  if (!reported.length) return null;
  const firstYear = Math.min(...reported.map((h) => +h.period));
  const lastYear = Math.max(...reported.map((h) => +h.period));
  const byYear = new Map(reported.map((h) => [+h.period, h.value]));
  const values: Array<number | null> = [];
  for (let year = firstYear; year <= lastYear; year++) values.push(byYear.get(year) ?? null);
  return { values, firstYear, lastYear, observations: reported.length };
}

const nonNegative = (n: number) => Math.max(0, n);

/** Forecasts imports up to and including `targetYear` (the app's "next
 * year"). Never throws: every failure becomes a typed status the UI and the
 * cache can reason about. `low`/`high` are the model's 10th/90th percentiles
 * for that single year, i.e. an 80% interval. */
export async function forecastAnnualImports(
  history: AnnualPoint[],
  targetYear: number,
  config: TimesfmConfig | null = readTimesfmConfig(),
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<TimesfmOutlook> {
  if (!config) return { status: "not-configured" };
  const series = buildAnnualSeries(history);
  const observations = series?.observations ?? 0;
  if (!series || observations < MIN_OBSERVATIONS) return { status: "insufficient-history", observations, needed: MIN_OBSERVATIONS };
  const steps = targetYear - series.lastYear;
  if (steps < 1 || steps > MAX_STEPS_AHEAD) {
    return { status: "insufficient-history", observations, needed: MIN_OBSERVATIONS };
  }
  try {
    const result = await forecastSeries(series.values, steps, config, fetcher, wait);
    const lastValue = series.values[series.values.length - 1] as number;
    const path = result.point.map((point, i) => ({
      year: series.lastYear + i + 1,
      value: nonNegative(point),
      low: nonNegative(result.low[i]),
      high: nonNegative(result.high[i]),
    }));
    const target = path[path.length - 1];
    return {
      status: "ok",
      model: result.model,
      nextYear: target.year,
      value: target.value,
      low: target.low,
      high: target.high,
      growthRate: lastValue > 0 ? target.value / lastValue - 1 : 0,
      lastObservedYear: series.lastYear,
      observations,
      path,
    };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : "TimesFM service unavailable" };
  }
}
