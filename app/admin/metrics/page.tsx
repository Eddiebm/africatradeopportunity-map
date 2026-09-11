import { requirePlatformRole } from "../../../lib/auth/current-user";
import { computeBusinessMetrics } from "../../../lib/business-metrics";

// Priority 13 (docs/production-readiness.md): "Business-validation
// dashboard ... Do NOT prioritize registrations, listing counts, or page
// views as proof of traction." Administrator-only (not
// verification_analyst — this is business-level information, a
// different real access question from evidence review, which is why it
// gets a narrower gate than the rest of the admin console). A Server
// Component reading lib/business-metrics.ts directly, same pattern as
// app/corridors/page.tsx — no separate client-fetched API needed for a
// read-only internal report.
function fmtDays(v: number): string {
  return `${v.toFixed(1)} day${Math.abs(v) === 1 ? "" : "s"}`;
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default async function BusinessMetricsPage() {
  await requirePlatformRole("/admin/metrics", ["administrator"]);
  const m = await computeBusinessMetrics();

  return (
    <main className="admin">
      <header>
        <div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Business validation</small></span></div>
        <nav><a href="/admin">Verification desk</a><a href="/">Atlas</a></nav>
      </header>
      <section className="adminhead">
        <div>
          <p>INTERNAL — REAL DATA ONLY</p>
          <h1>Traction, not vanity</h1>
          <span>
            Every figure below comes from real deals, quotes, verifications, disputes and referrals already recorded
            on this platform — never registrations, listing counts, or page views. A metric this platform cannot
            honestly compute yet is labeled &quot;not tracked,&quot; never shown as zero or estimated.
          </span>
        </div>
        <aside><b>{new Date(m.generatedAt).toISOString().slice(0, 16).replace("T", " ")}</b><span>generated (UTC)</span></aside>
      </section>

      <section className="roommetrics" style={{ margin: "0 5vw 20px" }}>
        <article><small>QUALIFIED BUYER REQUESTS</small><b>{m.qualifiedBuyerRequests.verified}</b><span>verified of {m.qualifiedBuyerRequests.total} total ({m.qualifiedBuyerRequests.pendingReview} pending review, {m.qualifiedBuyerRequests.rejected} rejected)</span></article>
        <article><small>VERIFIED SUPPLIERS</small><b>{m.verifiedSuppliers}</b><span>organizations at verificationStatus: verified</span></article>
        <article><small>PARTNER-REFERRED LEADS</small><b>{m.partnerReferredLeads.total}</b><span>{m.partnerReferredLeads.bySource.intake_link} via referral link · {m.partnerReferredLeads.bySource.code_entry} via code at signup</span></article>
        <article><small>ACQUISITION COST / QUALIFIED BUYER</small><b>Not tracked</b><span>{!m.acquisitionCostPerQualifiedBuyer.available && m.acquisitionCostPerQualifiedBuyer.reason}</span></article>
      </section>

      <section className="roommetrics" style={{ margin: "0 5vw 20px" }}>
        <article><small>TIME TO FIRST USEFUL QUOTE</small><b>{m.timeToFirstUsefulQuoteDays.available ? fmtDays(m.timeToFirstUsefulQuoteDays.value) : "—"}</b><span>{m.timeToFirstUsefulQuoteDays.available ? "average, deal creation → first real quote" : m.timeToFirstUsefulQuoteDays.reason}</span></article>
        <article><small>QUOTE → PAYMENT-CONFIRMED CONVERSION</small><b>{m.quoteToPaymentConfirmedConversionPct.available ? `${m.quoteToPaymentConfirmedConversionPct.value.toFixed(1)}%` : "—"}</b><span>{m.quoteToPaymentConfirmedConversionPct.available ? "of deals with a real quote" : m.quoteToPaymentConfirmedConversionPct.reason}</span></article>
        <article><small>TRANSACTIONS INITIATED / COMPLETED</small><b>{m.transactionsInitiated} / {m.transactionsCompleted}</b><span>completed = real stage: closed</span></article>
        <article><small>REPEAT-TRANSACTION OWNERS</small><b>{m.repeatTransactionOwners}</b><span>accounts with 2+ deals opened</span></article>
      </section>

      <section className="roommetrics" style={{ margin: "0 5vw 20px" }}>
        <article><small>LANDED-COST ACCURACY</small><b>{m.landedCostAccuracy.averageVariancePct.available ? fmtPct(m.landedCostAccuracy.averageVariancePct.value) : "—"}</b><span>{m.landedCostAccuracy.averageVariancePct.available ? `average actual vs. estimate, ${m.landedCostAccuracy.dealsWithActuals} deal(s) with recorded actuals` : m.landedCostAccuracy.averageVariancePct.reason}</span></article>
        <article><small>MANUAL INTERVENTIONS / TRANSACTION</small><b>{m.manualInterventionsPerTransaction.available ? m.manualInterventionsPerTransaction.value.toFixed(1) : "—"}</b><span>real admin actions logged per deal (approximate — see docs)</span></article>
        <article><small>VERIFICATION TURNAROUND</small><b>{m.verificationTurnaroundDays.available ? fmtDays(m.verificationTurnaroundDays.value) : "—"}</b><span>{m.verificationTurnaroundDays.available ? "average, deal creation → counterparties_verified" : m.verificationTurnaroundDays.reason}</span></article>
        <article><small>ON-TIME MILESTONES</small><b>{m.onTimeMilestones.withDueDate ? `${m.onTimeMilestones.verifiedOnTime}/${m.onTimeMilestones.verifiedOnTime + m.onTimeMilestones.verifiedLate}` : "—"}</b><span>of milestones with a real due date that have been verified so far</span></article>
      </section>

      <section className="roommetrics" style={{ margin: "0 5vw 20px" }}>
        <article><small>DISPUTES</small><b>{m.disputes.open} open</b><span>{m.disputes.resolved} resolved of {m.disputes.total} total</span></article>
        <article><small>AVERAGE DISPUTE RESOLUTION</small><b>{m.disputes.averageResolutionDays.available ? fmtDays(m.disputes.averageResolutionDays.value) : "—"}</b><span>{!m.disputes.averageResolutionDays.available && m.disputes.averageResolutionDays.reason}</span></article>
        <article><small>REVENUE / TRANSACTION</small><b>Not tracked</b><span>{!m.revenuePerTransaction.available && m.revenuePerTransaction.reason}</span></article>
      </section>

      <footer className="adminnote">
        This dashboard never uses registration counts, listing counts, or page views as evidence of traction — see
        docs/production-readiness.md&apos;s Priority 13 section for exactly how every figure above is computed, and
        which two metrics (acquisition cost, revenue per transaction) this platform genuinely cannot compute yet.
      </footer>
    </main>
  );
}
