import { asc, eq } from "drizzle-orm";
import { requireUser } from "../../../lib/auth/current-user";
import { getDb } from "../../../db";
import { disputeEvents, disputeMessages, disputes } from "../../../db/schema";
import DisputeMessageForm from "../../components/DisputeMessageForm";

export const dynamic = "force-dynamic";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

export default async function DisputeDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/disputes");
  const id = Number((await params).id);
  const db = getDb();
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);

  const isOwner = Boolean(dispute && dispute.openedByEmail === user.email);
  const isReviewer = Boolean(user.platformRole && REVIEWER_ROLES.includes(user.platformRole));

  // Not-found and not-authorized render identically — see the same
  // convention in app/api/disputes/[id]/route.ts.
  if (!dispute || (!isOwner && !isReviewer)) {
    return <main className="portal"><section className="portalempty"><h1>Dispute not found</h1><a href="/disputes">Return to the resolution center</a></section></main>;
  }

  const [messages, events] = await Promise.all([
    db.select().from(disputeMessages).where(eq(disputeMessages.disputeId, id)).orderBy(asc(disputeMessages.id)),
    db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, id)).orderBy(asc(disputeEvents.id)),
  ]);
  // Internal-audience messages never reach the dispute opener's own view.
  const visibleMessages = isReviewer ? messages : messages.filter((m) => m.audience === "parties");

  return <main className="portal">
    <header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>{dispute.reference}</small></span></div><nav><a href="/disputes">Resolution center</a><a href="/dashboard">My deals</a></nav></header>
    <section className="portalhead"><div><p>{dispute.category.replaceAll("_", " ").toUpperCase()}</p><h1>{dispute.reference}</h1><span>Deal #{dispute.dealId} · Opened by {dispute.openedByEmail}</span></div><aside><b>{dispute.status.replaceAll("_", " ")}</b><span>{dispute.priority} priority</span></aside></section>
    <section className="roomgrid">
      <article>
        <div className="roomtitle"><small>CASE DETAILS</small><b>{dispute.disputedAmount ? `${dispute.currency} ${dispute.disputedAmount.toLocaleString()}` : "Amount not stated"}</b></div>
        <p>{dispute.description}</p>
        {dispute.requestedResolution && <p><b>Requested resolution:</b> {dispute.requestedResolution}</p>}
        {dispute.assignedToEmail && <p><b>Assigned to:</b> {dispute.assignedToEmail}</p>}
        {dispute.status === "resolved" || dispute.status === "closed" ? <p><b>Resolution:</b> {dispute.resolutionSummary || "—"}</p> : null}
      </article>
      <article>
        <div className="roomtitle"><small>STATUS HISTORY</small><b>{events.length} events</b></div>
        {events.map((event) => <div className="task" key={event.id}><i>·</i><span><b>{event.eventType.replaceAll("_", " ")}</b><small>{event.createdAt} · {event.summary}</small></span></div>)}
      </article>
    </section>
    <section className="timeline">
      <div className="roomtitle"><small>MESSAGES</small><b>{visibleMessages.length}</b></div>
      {visibleMessages.length
        ? visibleMessages.map((m) => <p key={m.id}><i>{m.createdAt}</i><span><b>{m.authorEmail}</b>{m.audience === "internal" ? " (internal)" : ""} — {m.body}</span></p>)
        : <p><span>No messages yet.</span></p>}
      <DisputeMessageForm disputeId={id} canPostInternal={isReviewer} />
    </section>
    <section className="resolutionnote"><b>Important:</b> This record documents the case. It does not prove a claim, freeze funds, or guarantee recovery. Only a licensed payment or escrow partner can hold or release money.</section>
  </main>;
}
