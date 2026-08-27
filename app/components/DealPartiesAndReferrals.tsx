"use client";
import { useState } from "react";
import { ORGANIZATION_ROLES } from "../../db/schema";

type Party = { id: number; role: string; name: string; contact: string; organizationId: number | null };

// Priority 11 (docs/production-readiness.md): "post-deal: invite a
// participant, refer buyer/supplier, ... transparent referral credit."
// "Invite a participant" wires a real UI onto the API Priority 1 already
// built (POST/DELETE /api/deals/:id/parties) — that route existed with no
// form calling it until now, a real gap closed here, not new surface.
export default function DealPartiesAndReferrals({ dealId, parties, myOrganizations, isOwner }: { dealId: number; parties: Party[]; myOrganizations: { id: number; legalName: string }[]; isOwner: boolean }) {
  const [state, setState] = useState("");
  const [refLink, setRefLink] = useState("");
  const [refState, setRefState] = useState("");

  async function invite(formData: FormData) {
    setState("Adding participant…");
    const body = Object.fromEntries(formData.entries());
    const res = await fetch(`/api/deals/${dealId}/parties`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setState("");
      location.reload();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not add participant.");
    }
  }

  async function remove(partyId: number) {
    setState("Removing…");
    const res = await fetch(`/api/deals/${dealId}/parties`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partyId }),
    });
    if (res.ok) location.reload();
    else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not remove participant.");
    }
  }

  async function generateReferralLink() {
    if (!myOrganizations.length) {
      setRefState("A referral link is generated for your organization — create or join one first.");
      return;
    }
    setRefState("Generating…");
    const res = await fetch("/api/referrals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: myOrganizations[0].id }),
    });
    if (res.ok) {
      const d = (await res.json()) as { referralPartner: { code: string } };
      setRefLink(`${location.origin}/r/${d.referralPartner.code}`);
      setRefState("");
    } else {
      const d = (await res.json()) as { error?: string };
      setRefState(d.error || "Could not generate a referral link.");
    }
  }

  return (
    <div>
      <div className="roomtitle"><small>PARTICIPANTS</small><b>{parties.length} on this deal</b></div>
      {parties.map((p) => (
        <div className="task" key={p.id}>
          <i>•</i>
          <span><b>{p.role.replaceAll("_", " ")}</b><small>{p.name || (p.organizationId ? `Organization #${p.organizationId}` : "")} {p.contact ? `· ${p.contact}` : ""}</small></span>
          {isOwner && <button className="reject" onClick={() => remove(p.id)}>Remove</button>}
        </div>
      ))}
      {isOwner && (
        <>
          <form className="dealform" style={{ margin: "12px 0", gridTemplateColumns: "1fr 1fr 1fr 1fr" }} action={invite}>
            <label>
              Role
              <select name="role" required defaultValue="">
                <option value="" disabled>Choose</option>
                {ORGANIZATION_ROLES.map((r) => <option key={r} value={r}>{r.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label>Name<input name="name" placeholder="Optional" /></label>
            <label>Contact<input name="contact" placeholder="Email or phone" /></label>
            <button type="submit">Invite participant →</button>
          </form>
          {state && <strong>{state}</strong>}

          <div className="roomtitle" style={{ marginTop: 20 }}><small>REFERRALS</small><b>Share this deal type</b></div>
          <p style={{ fontSize: 12, margin: "0 0 10px" }}>
            Refer a buyer or supplier — if they start a real transaction through your link, your organization is
            credited for the introduction. Any commission is reviewed and approved by TradeSafe Africa; nothing is
            paid automatically through this platform.
          </p>
          <button onClick={generateReferralLink} type="button">Get a referral link →</button>
          {refLink && <p style={{ fontSize: 12, wordBreak: "break-all" }}><b>{refLink}</b></p>}
          {refState && <strong>{refState}</strong>}
        </>
      )}
    </div>
  );
}
