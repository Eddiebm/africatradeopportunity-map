export default function Privacy() {
  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Privacy Policy</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
        </nav>
      </header>
      <section className="portalempty" style={{ margin: "48px 6vw", maxWidth: 820 }}>
        <p style={{ fontSize: 9, letterSpacing: ".16em", color: "#8f621b" }}>DRAFT — REQUIRES LEGAL COUNSEL REVIEW</p>
        <h1>Privacy Policy</h1>
        <p>
          This placeholder exists so account creation has somewhere to point during development. It is not a
          reviewed or binding legal document.
        </p>
        <h2 style={{ fontSize: 18 }}>What is stored</h2>
        <p>
          Account data (email, password hash, display name), organization and listing data you submit, deal room
          content (cost assumptions, verification-check status, uploaded documents, messages, milestones), and
          activity/audit records needed to run the platform and investigate disputes. Documents you upload are
          stored privately (Cloudflare R2) and are never made public; access is limited to the deal&rsquo;s
          participants and platform reviewers with a logged reason.
        </p>
        <h2 style={{ fontSize: 18 }}>Your rights</h2>
        <p>
          You can request deletion of your account from <a href="/account">your account page</a> once signed in.
          This anonymizes your name, email, and password and signs you out everywhere; it does not erase your deal,
          dispute, or verification history, which this platform and any counterparties keep as a real record of what
          happened (login/security and staff-decision logs are separately capped at a 3-year retention window; deal,
          dispute, and verification records are not currently time-limited). If you have an open deal, dispute, or
          exception, your request is held for staff review instead of processing automatically. A self-service
          data-export flow is not yet built; until it is, contact the operator directly to request a copy of your
          data.
        </p>
        <p>
          A complete Privacy Policy — covering legal basis for processing, retention periods, sub-processors, and
          cross-border transfer — must be drafted and approved by qualified counsel before production launch. Do not
          treat this page as legally sufficient.
        </p>
      </section>
    </main>
  );
}
