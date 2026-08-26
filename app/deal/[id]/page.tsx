import { and, asc, eq } from "drizzle-orm";
import { requireUser } from "../../../lib/auth/current-user";
import { getDb } from "../../../db";
import { dealCosts, dealDocuments, dealEvents, deals, documentFiles, milestones, verificationChecks } from "../../../db/schema";
import DocumentUploadRow from "../../components/DocumentUploadRow";

export const dynamic = "force-dynamic";

export default async function DealRoom({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard");
  const id = Number((await params).id);
  const db = getDb();
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, id), eq(deals.ownerEmail, user.email))).limit(1);
  if (!deal) return <main className="portal"><section className="portalempty"><h1>Deal not found</h1><a href="/dashboard">Return to your trade desk</a></section></main>;
  const [costRows, checks, documents, files, steps, events] = await Promise.all([
    db.select().from(dealCosts).where(eq(dealCosts.dealId, id)).limit(1),
    db.select().from(verificationChecks).where(eq(verificationChecks.dealId, id)),
    db.select().from(dealDocuments).where(eq(dealDocuments.dealId, id)),
    db.select().from(documentFiles).where(and(eq(documentFiles.dealId, id),eq(documentFiles.fileStatus,"active"))).orderBy(asc(documentFiles.id)),
    db.select().from(milestones).where(eq(milestones.dealId, id)).orderBy(asc(milestones.sequence)),
    db.select().from(dealEvents).where(eq(dealEvents.dealId, id)).orderBy(asc(dealEvents.id)),
  ]);
  const cost = costRows[0];
  const spoilage = (cost?.supplierCost || 0) * (cost?.lossPercent || 0) / 100;
  const landed = (cost?.supplierCost || 0) + (cost?.freight || 0) + (cost?.borderTaxes || 0) + (cost?.inspection || 0) + (cost?.insurance || 0) + (cost?.financeFx || 0) + (cost?.contingency || 0) + spoilage;
  const profit = (cost?.expectedRevenue || 0) - landed;
  const passed = checks.filter((x) => x.status === "verified").length;
  const score = checks.length ? Math.round(passed / checks.length * 100) : 0;
  return <main className="portal">
    <header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>{deal.reference}</small></span></div><nav><a href="/dashboard">My deals</a><a href="/">Opportunity map</a></nav></header>
    <section className="roomhead"><div><p>{deal.stage.toUpperCase()}</p><h1>{deal.product}</h1><span>{deal.origin} → {deal.destination} · {deal.quantity || "—"} {deal.unit}</span></div><aside className={score < 50 ? "danger" : score < 88 ? "warning" : "ready"}><b>{score}</b><span>/100 evidence score</span></aside></section>
    <section className="roommetrics"><article><small>ESTIMATED LANDED COST</small><b>${landed.toLocaleString()}</b></article><article><small>REPORTED SALE VALUE</small><b>${(cost?.expectedRevenue || 0).toLocaleString()}</b></article><article><small>ESTIMATED PROFIT</small><b className={profit >= 0 ? "positive" : "negative"}>${profit.toLocaleString()}</b></article><article><small>DECISION</small><b>{profit > 0 && score === 100 ? "REVIEW TO PROCEED" : "HOLD"}</b></article></section>
    <section className="resolutionnote"><b>Commercial status:</b> These figures are user-reported estimates, not transaction-ready prices. Profit becomes quote-backed only after buyer and supplier quotes are accepted and unexpired. <a href="/disputes">Open the resolution center</a>.</section>
    <section className="roomgrid"><article><div className="roomtitle"><small>VERIFICATION</small><b>{passed}/{checks.length} verified</b></div>{checks.map((check) => <div className="task" key={check.id}><i>{check.status === "verified" ? "✓" : "—"}</i><span><b>{check.checkType.replaceAll("_", " ")}</b><small>{check.status}</small></span></div>)}</article>
      <article><div className="roomtitle"><small>SECURE DOCUMENT REGISTER</small><b>{documents.filter(x => x.status === "approved").length}/{documents.length} approved</b></div>{documents.map((doc) => {const file=files.filter(x=>x.dealDocumentId===doc.id).at(-1);return <DocumentUploadRow key={doc.id} dealId={id} documentId={doc.id} name={doc.documentType} status={doc.status} fileId={file?.id} fileName={file?.originalName}/>})}</article></section>
    <section className="release"><div className="roomtitle"><small>PROPOSED PAYMENT RELEASES</small><b>Licensed partner execution required</b></div>{steps.map((step) => <article key={step.id}><i>{step.sequence}</i><span><b>{step.name}</b><small>{step.releaseCondition}</small></span><strong>{step.percentage}%</strong></article>)}</section>
    <section className="timeline"><div className="roomtitle"><small>ACTIVITY</small><b>Audit trail</b></div>{events.map(event => <p key={event.id}><i>{event.createdAt}</i><span>{event.summary}</span></p>)}</section>
  </main>;
}
