"use client";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { loginPath } from "../../../lib/auth/paths";
import QuoteSubmitForm from "../../components/QuoteSubmitForm";

type Organization = { id: number; legalName: string; tradingName: string; country: string; registrationNumber: string; phone: string; verificationStatus: string; myRole: string; isOwner: boolean };
type Member = { id: number; email: string; displayName: string; role: string; status: string; invitedEmail: string; joinedAt: string | null };
type IncomingQuoteRequest = { id: string; dealId: number | null; quoteType: string; status: string; dueAt: string | null; createdAt: string };

const ROLES = [
  ["trader", "Trader"],
  ["buyer", "Buyer"],
  ["supplier", "Supplier"],
  ["freight_provider", "Freight provider"],
  ["inspector", "Inspector"],
  ["broker", "Broker"],
  ["partner_institution", "Partner institution"],
] as const;

export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [quoteRequests, setQuoteRequests] = useState<IncomingQuoteRequest[]>([]);
  const [state, setState] = useState("Loading…");
  const [inviteState, setInviteState] = useState("");

  async function load() {
    const r = await fetch(`/api/organizations/${id}`);
    if (r.status === 401) {
      location.href = loginPath(location.pathname);
      return;
    }
    const d = (await r.json()) as { organization?: Organization; members?: Member[]; incomingQuoteRequests?: IncomingQuoteRequest[]; error?: string };
    if (r.ok && d.organization) {
      setOrg(d.organization);
      setMembers(d.members || []);
      setQuoteRequests(d.incomingQuoteRequests || []);
      setState("");
    } else {
      setState(d.error || "Organization not found.");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteState("Sending invitation…");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const r = await fetch(`/api/organizations/${id}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { error?: string };
    if (r.ok) {
      (e.target as HTMLFormElement).reset();
      setInviteState("Invitation sent.");
      await load();
    } else {
      setInviteState(d.error || "Could not send invitation.");
    }
  }

  async function removeMember(memberId: number) {
    await fetch(`/api/organizations/${id}/members/${memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove" }),
    });
    await load();
  }

  if (!org) return <main className="portal"><section className="portalempty"><h1>{state}</h1><a href="/organizations">Back to organizations</a></section></main>;

  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Organization profile</small>
          </span>
        </div>
        <nav>
          <a href="/organizations">My organizations</a>
          <a href="/dashboard">My deals</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>{org.country.toUpperCase()}</p>
          <h1>{org.legalName}</h1>
        </div>
        <aside>
          <b>{org.verificationStatus.replaceAll("_", " ")}</b>
          <span>Your role: {org.myRole.replaceAll("_", " ")}</span>
        </aside>
      </section>

      <section className="roomgrid">
        <article>
          <div className="roomtitle">
            <small>PROFILE</small>
            <b>{org.tradingName || "No trading name set"}</b>
          </div>
          <div className="task">
            <span><b>Registration number</b><small>{org.registrationNumber || "Not provided"}</small></span>
          </div>
          <div className="task">
            <span><b>Phone</b><small>{org.phone || "Not provided"}</small></span>
          </div>
          <div className="task">
            <span><b>Verification</b><small>An administrator reviews organizations before marking them verified — this status is not self-assigned.</small></span>
          </div>
        </article>

        <article>
          <div className="roomtitle">
            <small>MEMBERS</small>
            <b>{members.filter((m) => m.status === "active").length} active</b>
          </div>
          {members.map((m) => (
            <div className="task" key={m.id}>
              <i>{m.status === "active" ? "✓" : m.status === "invited" ? "…" : "—"}</i>
              <span>
                <b>{m.displayName || m.email}</b>
                <small>{m.role.replaceAll("_", " ")} · {m.status}</small>
              </span>
              {org.isOwner && m.status !== "removed" && (
                <button onClick={() => removeMember(m.id)} style={{ marginLeft: "auto" }}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </article>
      </section>

      <section className="roomgrid">
        <article style={{ gridColumn: "1/3" }}>
          <div className="roomtitle">
            <small>QUOTE REQUESTS RECEIVED</small>
            <b>{quoteRequests.filter((q) => q.status === "requested").length} open</b>
          </div>
          {quoteRequests.length ? (
            quoteRequests.map((q) => (
              <div key={q.id}>
                <div className="task">
                  <i>{q.status === "requested" ? "…" : q.status === "quoted" ? "✓" : "—"}</i>
                  <span>
                    <b>{q.quoteType.replaceAll("_", " ")} quote{q.dealId ? ` — deal #${q.dealId}` : ""}</b>
                    <small>{q.status.replaceAll("_", " ")}{q.dueAt ? ` · needed by ${q.dueAt}` : ""}</small>
                  </span>
                </div>
                {q.status === "requested" && <QuoteSubmitForm quoteRequestId={q.id} />}
              </div>
            ))
          ) : (
            <p>No quote requests yet — these appear once a trader requests a quote from this organization.</p>
          )}
        </article>
      </section>

      {org.isOwner && (
        <form className="dealform" onSubmit={invite}>
          <label>
            Invite by email<input name="email" type="email" required placeholder="teammate@example.com" />
          </label>
          <label>
            Role
            <select name="role" required defaultValue="">
              <option value="" disabled>Choose a role</option>
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit">Send invitation →</button>
          <strong>{inviteState}</strong>
          <span style={{ fontSize: 10 }}>The invited person must already have a TradeSafe Africa account.</span>
        </form>
      )}
    </main>
  );
}
