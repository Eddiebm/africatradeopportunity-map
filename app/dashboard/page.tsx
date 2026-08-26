import { desc, eq } from "drizzle-orm";
import { requireUser } from "../../lib/auth/current-user";
import { getDb } from "../../db";
import { deals } from "../../db/schema";
import SignOutLink from "../components/SignOutLink";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const rows = await getDb().select().from(deals).where(eq(deals.ownerEmail, user.email)).orderBy(desc(deals.id)).limit(100);
  return <main className="portal">
    <header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Deal operations</small></span></div><nav><a href="/">Opportunity map</a><a href="/marketplace">Matches</a><a href="/notifications">Notifications</a><a href="/deal/new">Open a deal</a><a href="/disputes">Disputes</a><SignOutLink /></nav></header>
    <section className="portalhead"><div><p>MY TRADE DESK</p><h1>Deals requiring action</h1></div><aside><b>{rows.length}</b><span>active records</span></aside></section>
    <section className="dealboard">
      {rows.length ? rows.map((deal) => <a href={`/deal/${deal.id}`} className="dealcard" key={deal.id}>
        <div><i>{deal.reference}</i><b>{deal.stage.replaceAll("_", " ")}</b></div>
        <h2>{deal.product}</h2><p>{deal.origin} → {deal.destination}</p>
        <span>{deal.quantity || "—"} {deal.unit}</span><small>Risk: {deal.riskStatus}</small>
      </a>) : <div className="portalempty"><h2>No deals yet</h2><p>Open a buying, selling or freight request. TradeSafe will create its cost sheet, evidence checklist, document register and payment milestones.</p><a href="/deal/new">Open your first deal →</a></div>}
    </section>
  </main>;
}
