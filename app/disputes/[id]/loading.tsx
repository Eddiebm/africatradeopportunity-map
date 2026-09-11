// Production-hardening audit follow-up (Phase 1 — error handling). See
// app/dashboard/loading.tsx's header for why this exists.
export default function DisputeLoading() {
  return (
    <main className="portal">
      <section className="portalempty" aria-live="polite">
        <h1>Loading dispute…</h1>
        <p>Fetching case details and messages.</p>
      </section>
    </main>
  );
}
