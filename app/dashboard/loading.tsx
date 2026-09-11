// Production-hardening audit follow-up (Phase 1 — error handling: "add
// loading ... states"). This page's Server Component does a real D1 query
// before it can render anything — on a cold Worker start or a slow query,
// the visitor previously saw a blank tab with no feedback at all.
// App Router shows this automatically (via a Suspense boundary Next.js
// wraps the route in) while the page's own data fetch is in flight, then
// swaps to the real content. Matches app/not-found.tsx's existing
// `.portal`/`.portalempty` shell so it doesn't look like an unrelated UI
// flashing in.
export default function DashboardLoading() {
  return (
    <main className="portal">
      <section className="portalempty" aria-live="polite">
        <h1>Loading your dashboard…</h1>
        <p>Fetching your deals, matches, and notifications.</p>
      </section>
    </main>
  );
}
