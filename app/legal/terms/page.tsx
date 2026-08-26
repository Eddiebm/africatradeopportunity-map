export default function Terms() {
  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Terms of Service</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
        </nav>
      </header>
      <section className="portalempty" style={{ margin: "48px 6vw", maxWidth: 820 }}>
        <p style={{ fontSize: 9, letterSpacing: ".16em", color: "#ad7721" }}>DRAFT — REQUIRES LEGAL COUNSEL REVIEW</p>
        <h1>Terms of Service</h1>
        <p>
          This placeholder exists so account creation has somewhere to point during development. It is not a
          reviewed or binding legal document, and nothing on this page should be relied on as a legal assurance.
        </p>
        <h2 style={{ fontSize: 18 }}>What TradeSafe Africa is</h2>
        <p>
          TradeSafe Africa is a trade-intelligence and transaction-coordination platform. It helps traders discover
          demand, find nearby supply, calculate landed costs, post buying/selling/freight requirements, and
          coordinate a deal through review, evidence checks, documents and milestones.
        </p>
        <h2 style={{ fontSize: 18 }}>What it is not</h2>
        <ul>
          <li>Not a licensed payment, escrow, or money-transmission service. No customer funds are ever held.</li>
          <li>Not a regulated identity-verification, KYC, or credit-reference provider unless a named licensed partner is explicitly integrated for that check.</li>
          <li>Not insurance, and not a guarantee of any counterparty&rsquo;s performance, solvency, or good faith.</li>
          <li>A &ldquo;verified&rdquo; status records that a specific piece of evidence was reviewed by a specific reviewer on a specific date — it is not a warranty.</li>
        </ul>
        <p>
          A complete Terms of Service — covering acceptable use, liability limits, dispute handling, account
          termination, and governing law — must be drafted and approved by qualified counsel before production
          launch. Do not treat this page as legally sufficient.
        </p>
      </section>
    </main>
  );
}
