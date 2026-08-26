"use client";
import { FormEvent, useEffect, useState } from "react";
import { loginPath } from "../../lib/auth/paths";

type Org = { id: number; legalName: string; tradingName: string; country: string; verificationStatus: string; myRole: string };
type Invitation = { membershipId: number; organizationId: number; organizationName: string; role: string; invitedAt: string | null };

const ROLES = [
  ["trader", "Trader"],
  ["buyer", "Buyer"],
  ["supplier", "Supplier"],
  ["freight_provider", "Freight provider"],
  ["inspector", "Inspector"],
  ["broker", "Broker"],
  ["partner_institution", "Partner institution"],
] as const;

export default function Organizations() {
  const [mine, setMine] = useState<Org[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [state, setState] = useState("Loading…");
  const [formState, setFormState] = useState("");

  async function load() {
    const r = await fetch("/api/organizations");
    if (r.status === 401) {
      location.href = loginPath(location.pathname);
      return;
    }
    const d = (await r.json()) as { mine?: Org[]; invitations?: Invitation[] };
    setMine(d.mine || []);
    setInvitations(d.invitations || []);
    setState("");
  }
  useEffect(() => {
    load();
  }, []);

  async function respond(membershipId: number, organizationId: number, action: "accept" | "decline") {
    await fetch(`/api/organizations/${organizationId}/members/${membershipId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormState("Creating…");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const r = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { organization?: { id: number }; error?: string };
    if (r.ok && d.organization) {
      location.href = `/organizations/${d.organization.id}`;
    } else {
      setFormState(d.error || "Could not create organization.");
    }
  }

  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Organizations</small>
          </span>
        </div>
        <nav>
          <a href="/dashboard">My deals</a>
          <a href="/marketplace">Matches</a>
          <a href="/">Atlas</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>BUSINESS PROFILE</p>
          <h1>Your organizations</h1>
        </div>
        <aside>
          <b>{mine.length}</b>
          <span>active memberships</span>
        </aside>
      </section>
      {state && <p style={{ margin: "0 6vw" }}>{state}</p>}

      {invitations.length > 0 && (
        <section className="dealboard" style={{ marginBottom: 10 }}>
          {invitations.map((inv) => (
            <div className="dealcard" key={inv.membershipId}>
              <div>
                <i>Invitation</i>
                <b>{inv.role.replaceAll("_", " ")}</b>
              </div>
              <h2>{inv.organizationName}</h2>
              <p>You&rsquo;ve been invited to join as {inv.role.replaceAll("_", " ")}.</p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => respond(inv.membershipId, inv.organizationId, "accept")}>Accept</button>
                <button className="reject" onClick={() => respond(inv.membershipId, inv.organizationId, "decline")}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="dealboard">
        {mine.length
          ? mine.map((org) => (
              <a href={`/organizations/${org.id}`} className="dealcard" key={org.id}>
                <div>
                  <i>{org.country}</i>
                  <b>{org.myRole.replaceAll("_", " ")}</b>
                </div>
                <h2>{org.legalName}</h2>
                <p>{org.tradingName || "—"}</p>
                <span>{org.verificationStatus.replaceAll("_", " ")}</span>
              </a>
            ))
          : (
              <div className="portalempty">
                <h2>No organization yet</h2>
                <p>Create one below to post listings as a business, invite teammates, and unlock protected introductions once a match is verified.</p>
              </div>
            )}
      </section>

      <form className="dealform" onSubmit={submit}>
        <label>
          Legal name<input name="legalName" required maxLength={200} />
        </label>
        <label>
          Trading name<input name="tradingName" maxLength={200} />
        </label>
        <label>
          Country<input name="country" required maxLength={120} placeholder="Ghana" />
        </label>
        <label>
          Registration number<input name="registrationNumber" maxLength={100} />
        </label>
        <label>
          Phone<input name="phone" maxLength={40} />
        </label>
        <label>
          Your role in this organization
          <select name="role" required defaultValue="">
            <option value="" disabled>
              Choose a role
            </option>
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create organization →</button>
        <strong>{formState}</strong>
      </form>
    </main>
  );
}
