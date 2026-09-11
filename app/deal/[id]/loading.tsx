// Production-hardening audit follow-up (Phase 1 — error handling). See
// app/dashboard/loading.tsx's header for why this exists. This deal room
// page does several real, related D1 queries (deal, parties,
// verification checks, documents, milestones, landed cost) before
// rendering — the heaviest single page in the app to cold-load.
export default function DealRoomLoading() {
  return (
    <main className="portal">
      <section className="portalempty" aria-live="polite">
        <h1>Loading deal room…</h1>
        <p>Fetching deal details, parties, and documents.</p>
      </section>
    </main>
  );
}
