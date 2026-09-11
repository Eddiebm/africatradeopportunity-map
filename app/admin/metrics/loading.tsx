// Production-hardening audit follow-up (Phase 1 — error handling). See
// app/dashboard/loading.tsx's header for why this exists.
// computeBusinessMetrics() aggregates across many tables — the slowest
// single query path in the app, and the one most worth a loading state.
export default function MetricsLoading() {
  return (
    <main className="portal">
      <section className="portalempty" aria-live="polite">
        <h1>Loading business metrics…</h1>
        <p>Computing real figures from deal, quote, and verification data.</p>
      </section>
    </main>
  );
}
