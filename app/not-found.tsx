// Priority 3 (docs/production-readiness.md): "safe error pages" — a
// generic 404 with no leaked internals, matching this app's existing
// "not found" styling convention (see app/deal/[id]/page.tsx etc.).
export default function NotFound() {
  return (
    <main className="portal">
      <section className="portalempty">
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or may have moved.</p>
        <a href="/">Return to the Atlas</a>
      </section>
    </main>
  );
}
