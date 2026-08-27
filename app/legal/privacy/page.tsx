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
          A production account-settings flow for exporting your data and requesting deletion is part of this
          platform&rsquo;s onboarding scope; until that is live, contact the operator directly for either request.
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
