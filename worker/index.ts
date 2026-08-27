/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshStaleWatchlist } from "../lib/trade-intelligence";
import { logServerError, newCorrelationId } from "../lib/observability";
import { recordCronRun } from "../lib/cron-runs";
import { syncExceptionQueue } from "../lib/exceptions";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

// Batch size chosen to comfortably fit a Worker's CPU-time and subrequest
// limits for one Cron invocation (each entry does up to ~5 upstream
// fetches). The watchlist only grows as fast as real users generate
// lookups (see lib/trade-intelligence.ts), so this catches up over
// successive daily ticks rather than needing to process everything at once.
const WATCHLIST_REFRESH_BATCH_SIZE = 15;

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const CORRELATION_HEADER = "x-correlation-id";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // Priority 3 (docs/production-readiness.md): "Request and correlation
    // IDs" + "Structured server-side error logging." Generated once, at
    // the outermost point every request passes through, then threaded
    // onto the request (so proxy.ts and every Route Handler downstream
    // can read it back if they want it) and onto the response (so a
    // support conversation — "it broke, here's the id in dev tools" —
    // can be tied straight to a `wrangler tail` line). This try/catch is
    // the LAST line of defense: individual routes already return clean
    // JSON errors from their own try/catch (see docs/AUDIT.md's note that
    // this was already true before this priority) — this only fires for
    // something that slipped past all of them, so a raw exception + stack
    // trace never reaches a real user's browser as a broken response.
    const correlationId = request.headers.get(CORRELATION_HEADER) || newCorrelationId();
    const requestWithId = new Request(request, { headers: new Headers(request.headers) });
    requestWithId.headers.set(CORRELATION_HEADER, correlationId);

    try {
      const response = await handler.fetch(requestWithId, env, ctx);
      response.headers.set(CORRELATION_HEADER, correlationId);
      return response;
    } catch (error) {
      logServerError(correlationId, { method: request.method, pathname: url.pathname }, error);
      return new Response(
        JSON.stringify({ error: "Something went wrong. This has been logged.", correlationId }),
        { status: 500, headers: { "content-type": "application/json", [CORRELATION_HEADER]: correlationId } },
      );
    }
  },

  // Cron Trigger (see wrangler.jsonc's "triggers.crons") — refreshes the
  // most-stale entries in db/schema.ts's intelligenceWatchlist so the
  // Opportunity Finder and ImportIntelligence panel have current cached
  // data without every user request re-fetching UN Comtrade/World Bank.
  // env/ctx are unused directly — lib/trade-intelligence.ts's getDb() reads
  // the binding via `cloudflare:workers`'s ambient `env`, the same path
  // every Route Handler in this app already uses.
  async scheduled(_event: ScheduledEvent, _env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      // recordCronRun (lib/cron-runs.ts) persists this to db/schema.ts's
      // cronRuns table — console.log is still useful as a live tail, but
      // is no longer the ONLY record of whether this ran and succeeded.
      recordCronRun("intelligence-watchlist-refresh", () => refreshStaleWatchlist(WATCHLIST_REFRESH_BATCH_SIZE))
        .then((result) => {
          console.log(`[intelligence-watchlist] refreshed ${result.refreshed}, failed ${result.failed}`);
        })
        .catch((error) => {
          logServerError(newCorrelationId(), { method: "CRON", pathname: "intelligence-watchlist-refresh" }, error);
        }),
    );
    // Priority 8 (docs/production-readiness.md): "The standard operational
    // path should not require manually monitoring every deal" — this is
    // what makes that true even if no reviewer opens the exceptions queue
    // between ticks. Also runs lazily on every GET /api/admin/exceptions
    // (see that route), so this cron pass is a backstop, not the only path.
    ctx.waitUntil(
      recordCronRun("exception-queue-sync", () => syncExceptionQueue())
        .then((result) => {
          console.log(`[exception-queue] created ${result.created}, auto-resolved ${result.autoResolved}, open ${result.totalOpen}`);
        })
        .catch((error) => {
          logServerError(newCorrelationId(), { method: "CRON", pathname: "exception-queue-sync" }, error);
        }),
    );
  },
};

export default worker;
