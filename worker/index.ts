/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshStaleWatchlist } from "../lib/trade-intelligence";
import { logServerError, newCorrelationId } from "../lib/observability";
import { recordCronRun } from "../lib/cron-runs";
import { syncExceptionQueue } from "../lib/exceptions";
import { purgeExpiredAuditRecords } from "../lib/audit-retention";
import { processDueAccountDeletions } from "../lib/account-deletion";
import { runBackupAndPrune } from "../lib/data-backup";

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
    // Production-hardening audit follow-up: see lib/audit-retention.ts's
    // header comment for the full rationale (3-year retention window,
    // confirmed by the account owner, applied only to the two pure log
    // tables — securityEvents and adminAuditEvents).
    ctx.waitUntil(
      recordCronRun("audit-log-retention-purge", () => purgeExpiredAuditRecords())
        .then((result) => {
          console.log(`[audit-retention] purged ${result.securityEventsDeleted} securityEvents, ${result.adminAuditEventsDeleted} adminAuditEvents older than ${result.cutoff}`);
        })
        .catch((error) => {
          logServerError(newCorrelationId(), { method: "CRON", pathname: "audit-log-retention-purge" }, error);
        }),
    );
    // Production-hardening audit follow-up: see lib/account-deletion.ts's
    // header comment. Processes any deletion request whose grace period
    // has elapsed AND that never got held for admin review (no open deal/
    // dispute/exception at request time) — a daily backstop, same pattern
    // as the exception-queue-sync job above (also runs lazily wherever a
    // request first becomes due, see that module).
    ctx.waitUntil(
      recordCronRun("account-deletion-sweep", () => processDueAccountDeletions())
        .then((result) => {
          console.log(`[account-deletion] processed ${result.processed}, still pending ${result.stillPending}`);
        })
        .catch((error) => {
          logServerError(newCorrelationId(), { method: "CRON", pathname: "account-deletion-sweep" }, error);
        }),
    );
    // Launch-prep follow-up: see lib/data-backup.ts's header comment for
    // exactly what this is (a real, automated, application-level JSON
    // snapshot of every table — NOT a replacement for the manual
    // `wrangler d1 export` SQL dump docs/DEPLOYMENT.md still calls for
    // before a destructive migration). Closes the "no automated backup
    // Cron Trigger" gap that's been an explicit open risk since Priority 3.
    ctx.waitUntil(
      recordCronRun("data-backup", () => runBackupAndPrune())
        .then((result) => {
          console.log(`[data-backup] wrote ${result.key} (${result.totalRows} rows across ${Object.keys(result.tableCounts).length} tables); pruned ${result.deleted} backups past the retention window, kept ${result.kept}`);
        })
        .catch((error) => {
          logServerError(newCorrelationId(), { method: "CRON", pathname: "data-backup" }, error);
        }),
    );
  },
};

export default worker;
