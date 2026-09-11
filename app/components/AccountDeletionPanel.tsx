"use client";
import { useEffect, useState } from "react";

interface DeletionRequest {
  id: number;
  status: string;
  requestedAt: string;
  scheduledFor: string | null;
  heldReason: string;
  decisionReason: string;
}

// Production-hardening audit follow-up: the interactive half of
// app/account/page.tsx. See lib/account-deletion.ts's header comment for
// the full design this panel is a thin client for — it never decides
// anything itself, just calls the API and shows what came back.
export default function AccountDeletionPanel() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const r = await fetch("/api/account/deletion-request");
    const d = (await r.json()) as { request?: DeletionRequest | null };
    setRequest(d.request ?? null);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function requestDeletion() {
    if (!window.confirm("Request deletion of your TradeSafe Africa account? If you have no open deals, disputes, or exceptions, this will be processed automatically in 24 hours. You can cancel any time before then.")) return;
    setBusy(true);
    setMessage("");
    const r = await fetch("/api/account/deletion-request", { method: "POST" });
    const d = (await r.json()) as { request?: DeletionRequest; error?: string };
    setBusy(false);
    if (r.ok && d.request) setRequest(d.request);
    else setMessage(d.error || "Could not submit the request.");
  }

  async function cancel() {
    setBusy(true);
    setMessage("");
    const r = await fetch("/api/account/deletion-request", { method: "DELETE" });
    setBusy(false);
    if (r.ok) {
      setRequest(null);
      setMessage("Your deletion request was cancelled.");
    } else {
      const d = (await r.json()) as { error?: string };
      setMessage(d.error || "Could not cancel the request.");
    }
  }

  if (loading) return <section className="portalempty"><p>Loading…</p></section>;

  const active = request && (request.status === "pending" || request.status === "held_for_review");

  return (
    <section className="portalempty">
      <h2>Delete my account</h2>
      {message && <p>{message}</p>}
      {!active && (
        <>
          <p>
            This anonymizes your name, email, and password on your account and signs you out everywhere — it does not
            erase your deal, dispute, or verification history, which this platform (and the counterparties in it) keep
            as a real record of what happened. If you have an open deal, dispute, or exception, your request is held
            for a staff member to review instead of processing automatically.
          </p>
          {request && (request.status === "denied" || request.status === "cancelled") && request.decisionReason && (
            <p><i>Your last request was {request.status}: {request.decisionReason}</i></p>
          )}
          <button className="reject" disabled={busy} onClick={requestDeletion}>Request account deletion</button>
        </>
      )}
      {request && request.status === "pending" && (
        <p>
          Deletion request received. Unless cancelled, this will be processed automatically on or after{" "}
          <b>{new Date(request.scheduledFor || request.requestedAt).toLocaleString()}</b>.{" "}
          <button disabled={busy} onClick={cancel}>Cancel this request</button>
        </p>
      )}
      {request && request.status === "held_for_review" && (
        <p>
          Deletion request received, but held for staff review because: <b>{request.heldReason}</b>. A staff member
          will review it once those items are resolved or closed.{" "}
          <button disabled={busy} onClick={cancel}>Cancel this request</button>
        </p>
      )}
    </section>
  );
}
