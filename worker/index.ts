/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshStaleWatchlist } from "../lib/trade-intelligence";

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

    return handler.fetch(request, env, ctx);
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
      // console.log is the only observability a Cron Trigger has — shows up
      // in the dashboard Logs / `wrangler tail` (wrangler.jsonc's
      // observability.enabled).
      refreshStaleWatchlist(WATCHLIST_REFRESH_BATCH_SIZE).then((result) => {
        console.log(`[intelligence-watchlist] refreshed ${result.refreshed}, failed ${result.failed}`);
      }),
    );
  },
};

export default worker;
