import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "../../../lib/auth/current-user";
import { resolveDealViewAccess } from "../../../lib/auth/deal-access";
import { getDb } from "../../../db";
import { dealCosts, dealDocuments, dealEvents, documentFiles, milestones, organizationMembers, organizations, quoteRequests, quotes, verificationChecks } from "../../../db/schema";
import CheckEvidencePicker from "../../components/CheckEvidencePicker";
import DocumentUploadRow from "../../components/DocumentUploadRow";
import MilestoneEvidenceButton from "../../components/MilestoneEvidenceButton";
import QuoteActions from "../../components/QuoteActions";
import QuoteRequestForm from "../../components/QuoteRequestForm";
import { formatCurrency } from "../../../lib/i18n/format";

export const dynamic = "force-dynamic";

export default async function DealRoom({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard");
  const id = Number((await params).id);
  const db = getDb();
  // See lib/auth/deal-access.ts: an owner, an assigned verification
  // analyst/administrator, or a recognized counterparty on this deal
  // (via deal_parties) may view the deal room — not just the owner.
  const access = await resolveDealViewAccess(id, user);
  if (!access) return <main className="portal"><section className="portalempty"><h1>Deal not found</h1><a href="/dashboard">Return to your trade desk</a></section></main>;
  const { deal, reason: viewReason } = access;
  const isOwner = viewReason === "owner";
  const [costRows, checks, documents, files, steps, events, myOrgMemberships, dealQuoteRequests] = await Promise.all([
    db.select().from(dealCosts).where(eq(dealCosts.dealId, id)).limit(1),
    db.select().from(verificationChecks).where(eq(verificationChecks.dealId, id)),
    db.select().from(dealDocuments).where(eq(dealDocuments.dealId, id)),
    db.select().from(documentFiles).where(and(eq(documentFiles.dealId, id),eq(documentFiles.fileStatus,"active"))).orderBy(asc(documentFiles.id)),
    db.select().from(milestones).where(eq(milestones.dealId, id)).orderBy(asc(milestones.sequence)),
    db.select().from(dealEvents).where(eq(dealEvents.dealId, id)).orderBy(asc(dealEvents.id)),
    db.select({ organizationId: organizationMembers.organizationId, role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active"))),
    db.select().from(quoteRequests).where(eq(quoteRequests.dealId, id)).orderBy(desc(quoteRequests.createdAt)),
  ]);
  const dealQuotes = dealQuoteRequests.length
    ? await db.select().from(quotes).where(inArray(quotes.quoteRequestId, dealQuoteRequests.map((q) => q.id))).orderBy(desc(quotes.createdAt))
    : [];
  const cost = costRows[0];
  const spoilage = (cost?.supplierCost || 0) * (cost?.lossPercent || 0) / 100;
  const estimatedLanded = (cost?.supplierCost || 0) + (cost?.freight || 0) + (cost?.borderTaxes || 0) + (cost?.inspection || 0) + (cost?.insurance || 0) + (cost?.financeFx || 0) + (cost?.contingency || 0) + spoilage;

  // "Quote-backed" once at least one accepted, unexpired quote exists for
  // this deal — this is what app/deal/[id]/page.tsx has always promised
  // ("Profit becomes quote-backed only after buyer and supplier quotes are
  // accepted and unexpired") but had nothing behind it until now.
  // This route is `export const dynamic = "force-dynamic"` (see top of
  // file), so it is never statically cached/reused across requests — the
  // purity concern react-hooks/purity guards against doesn't apply here,
  // and expiry genuinely needs the real wall-clock time on every render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const acceptedQuote = dealQuotes.find((q) => q.status === "accepted" && new Date(q.validUntil).getTime() > now);
  const quoteLanded = acceptedQuote ? acceptedQuote.goodsTotal + acceptedQuote.freightTotal + acceptedQuote.borderEstimate + acceptedQuote.inspectionTotal + acceptedQuote.insuranceTotal + acceptedQuote.financeFxTotal + acceptedQuote.otherTotal : null;
  const landed = quoteLanded ?? estimatedLanded;
  const profit = (cost?.expectedRevenue || 0) - landed;
  const passed = checks.filter((x) => x.status === "verified").length;
  const score = checks.length ? Math.round(passed / checks.length * 100) : 0;

  // Need real organization names for the request form's dropdown — the
  // membership query above only gave us ids (drizzle doesn't let a select
  // alias pull from a different table without a join).
  const myOrgIds = myOrgMemberships.map((m) => m.organizationId);
  const myOrgNames = myOrgIds.length
    ? await db.select().from(organizations).where(inArray(organizations.id, myOrgIds))
    : [];
  const myOrganizations = myOrgMemberships.map((m) => ({ id: m.organizationId, myRole: m.role, legalName: myOrgNames.find((o) => o.id === m.organizationId)?.legalName || `Organization #${m.organizationId}` }));

  return <main className="portal">
    <header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>{deal.reference}</small></span></div><nav>{!isOwner && <span className="viewbadge">Viewing as {viewReason === "platform_role" ? "verification staff" : "counterparty"} — read only</span>}<a href="/dashboard">My deals</a><a href="/">Opportunity map</a></nav></header>
    <section className="roomhead"><div><p>{deal.stage.toUpperCase()}</p><h1>{deal.product}</h1><span>{deal.origin} → {deal.destination} · {deal.quantity || "—"} {deal.unit}</span></div><aside className={score < 50 ? "danger" : score < 88 ? "warning" : "ready"}><b>{score}</b><span>/100 evidence score</span></aside></section>
    <section className="roommetrics"><article><small>{quoteLanded ? "QUOTE-BACKED LANDED COST" : "ESTIMATED LANDED COST"}</small><b>{formatCurrency(landed, deal.currency)}</b></article><article><small>REPORTED SALE VALUE</small><b>{formatCurrency(cost?.expectedRevenue || 0, deal.currency)}</b></article><article><small>{quoteLanded ? "QUOTE-BACKED PROFIT" : "ESTIMATED PROFIT"}</small><b className={profit >= 0 ? "positive" : "negative"}>{formatCurrency(profit, deal.currency)}</b></article><article><small>DECISION</small><b>{profit > 0 && score === 100 ? "REVIEW TO PROCEED" : "HOLD"}</b></article></section>
    <section className="resolutionnote"><b>Commercial status:</b> {quoteLanded ? "These figures are backed by an accepted, unexpired quote from the counterparty organization — still not a binding contract without one." : "These figures are user-reported estimates, not transaction-ready prices."} Profit becomes quote-backed only after buyer and supplier quotes are accepted and unexpired. <a href="/disputes">Open the resolution center</a>.</section>
    <section className="roomgrid"><article><div className="roomtitle"><small>VERIFICATION</small><b>{passed}/{checks.length} verified</b></div>{checks.map((check) => {const evidenceFile=check.evidenceFileId?files.find(f=>f.id===check.evidenceFileId):undefined;return <div className="task" key={check.id}><i>{check.status === "verified" ? "✓" : "—"}</i><span><b>{check.checkType.replaceAll("_", " ")}</b><small>{check.status}{evidenceFile?` · ${evidenceFile.originalName}`:""}</small></span>{!evidenceFile && isOwner && <CheckEvidencePicker dealId={id} checkId={check.id} files={files} />}</div>})}</article>
      <article><div className="roomtitle"><small>SECURE DOCUMENT REGISTER</small><b>{documents.filter(x => x.status === "approved").length}/{documents.length} approved</b></div>{documents.map((doc) => {const file=files.filter(x=>x.dealDocumentId===doc.id).at(-1);return <DocumentUploadRow key={doc.id} dealId={id} documentId={doc.id} name={doc.documentType} status={doc.status} fileId={file?.id} fileName={file?.originalName} canUpload={isOwner}/>})}</article></section>
    <section className="roomgrid">
      <article style={{ gridColumn: "1/3" }}>
        <div className="roomtitle"><small>QUOTATIONS</small><b>{dealQuotes.length} received</b></div>
        {isOwner && <QuoteRequestForm dealId={id} myOrganizations={myOrganizations} />}
        {dealQuoteRequests.length ? dealQuoteRequests.map((qr) => {
          const quotesForRequest = dealQuotes.filter((q) => q.quoteRequestId === qr.id);
          return <div key={qr.id} style={{ borderTop: "1px solid #e1e2da", paddingTop: 10, marginTop: 10 }}>
            <div className="task"><i>{qr.status === "requested" ? "…" : qr.status === "accepted" ? "✓" : "—"}</i><span><b>{qr.quoteType.replaceAll("_", " ")} quote request</b><small>{qr.status.replaceAll("_", " ")}{qr.dueAt ? ` · needed by ${qr.dueAt}` : ""}</small></span></div>
            {quotesForRequest.map((q) => <div className="task" key={q.id}><i>$</i><span><b>{formatCurrency(q.goodsTotal + q.freightTotal + q.borderEstimate + q.inspectionTotal + q.insuranceTotal + q.financeFxTotal + q.otherTotal, q.currency)} total landed</b><small>{q.status} · valid until {q.validUntil} · {q.assumptions.slice(0, 120)}{q.assumptions.length > 120 ? "…" : ""}</small></span>{q.status === "submitted" && isOwner && <QuoteActions quoteId={q.id} />}</div>)}
          </div>;
        }) : <p>No quote requests yet for this deal — request one above once you have a counterparty organization in mind.</p>}
      </article>
    </section>
    <section className="release"><div className="roomtitle"><small>PROPOSED PAYMENT RELEASES</small><b>Licensed partner execution required</b></div>{steps.map((step) => <article key={step.id}><i>{step.sequence}</i><span><b>{step.name}</b><small>{step.releaseCondition}</small></span><strong>{step.percentage}%</strong>{isOwner ? <MilestoneEvidenceButton dealId={id} milestoneId={step.id} evidenceStatus={step.evidenceStatus} /> : <small>{step.evidenceStatus.replaceAll("_", " ")}</small>}</article>)}</section>
    <section className="timeline"><div className="roomtitle"><small>ACTIVITY</small><b>Audit trail</b></div>{events.map(event => <p key={event.id}><i>{event.createdAt}</i><span>{event.summary}</span></p>)}</section>
  </main>;
}
