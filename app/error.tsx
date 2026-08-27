"use client";
// Priority 3 (docs/production-readiness.md): "safe error pages" — a
// Next.js/vinext error boundary catches anything an individual route's own
// try/catch didn't (most already return clean JSON errors; this is the
// last line of defense for a rendering-time throw). Deliberately shows a
// generic message and NEVER the error's own .message/.stack — those can
// contain internals (a query fragment, a file path) that shouldn't reach
// a browser. The correlation id (see lib/observability.ts) is the actual
// debugging thread: it's already in the server logs via the request-level
// handler in worker/index.ts, tied to this same request.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="portal">
      <section className="portalempty">
        <h1>Something went wrong</h1>
        <p>
          This page hit an unexpected error. It has been logged. You can try again, or return to
          the Atlas if the problem continues.
        </p>
        <button onClick={reset} style={{ marginRight: 12 }}>
          Try again
        </button>
        <a href="/">Return to the Atlas</a>
      </section>
    </main>
  );
}
