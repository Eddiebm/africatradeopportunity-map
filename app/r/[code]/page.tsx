import { resolveReferralPartner } from "../../../lib/referrals";

// Priority 11 (docs/production-readiness.md): "partner-specific intake
// links" + "disclosure of who pays commissions" + "never reveal private
// deal details through referral links." resolveReferralPartner()
// structurally cannot return anything beyond a public organization name
// (see lib/referrals.ts) — there is no deal, document, or contact detail
// this page could leak even by mistake. The disclosure below is
// deliberately GENERIC (a policy statement, not a specific commission
// amount) — a specific rate/payer is only ever decided per-deal by an
// administrator (see app/api/admin/commissions/route.ts), long after
// this page is shown to a visitor who hasn't even submitted anything yet.
export default async function ReferralLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const partner = await resolveReferralPartner(code);

  if (!partner || partner.status !== "active") {
    return (
      <main className="quotepage">
        <header>
          <div><b>TradeSafe Africa</b></div>
          <a href="/">Home</a>
        </header>
        <section className="quoteconfirm">
          <h2>This referral link is not active.</h2>
          <p>You can still use TradeSafe Africa directly — nothing about this link is required to get a quote or create an account.</p>
          <a href="/quote">Get your landed cost</a>
          <a className="secondary" href="/">Continue browsing</a>
        </section>
      </main>
    );
  }

  const refParam = `?ref=${encodeURIComponent(code.toUpperCase())}`;

  return (
    <main className="quotepage">
      <header>
        <div><b>TradeSafe Africa</b></div>
        <a href="/">Home</a>
      </header>
      <section className="quotehero">
        <p>REFERRED BY {partner.organizationName.toUpperCase()}</p>
        <h1>Know your complete landed cost before sending money.</h1>
        <span>
          You were referred by <b>{partner.organizationName}</b>. If a transaction results from this
          introduction, {partner.organizationName} may be eligible for a commission — reviewed and approved by
          TradeSafe Africa, tracked internally, and never funded or transferred through this platform. This does
          not change the price you pay or the terms of any deal.
        </span>
      </section>
      <section className="quoteconfirm">
        <h2>Continue to TradeSafe Africa</h2>
        <p>No account is required to request a quote. Your details stay private — this referral only credits {partner.organizationName} for the introduction, nothing more.</p>
        <a href={`/quote${refParam}`}>Get your landed cost</a>
        <a className="secondary" href={`/register${refParam}`}>Create an account instead</a>
      </section>
    </main>
  );
}
