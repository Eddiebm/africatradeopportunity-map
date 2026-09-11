// Priority 3 (docs/production-readiness.md): "Structured server-side
// error logging" + "Request and correlation IDs." A Cloudflare Worker's
// only real-time observability is stdout/stderr (visible via
// `wrangler tail` or the dashboard Logs tab — see wrangler.jsonc's
// observability.enabled) so "structured logging" here means one
// single-line JSON object per error, not a log aggregation service this
// app doesn't have.
//
// SAFETY CONTRACT, same spirit as lib/auth/security-events.ts: never log
// a request body, a cookie/session value, a password, or a token. This
// module only ever receives an error object and route metadata (method +
// pathname) — it has no access to the request body by construction, so
// there's no path for one to leak in here.
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function logServerError(correlationId: string, context: { method: string; pathname: string }, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      correlationId,
      method: context.method,
      pathname: context.pathname,
      message,
      stack,
      timestamp: new Date().toISOString(),
    }),
  );
}
