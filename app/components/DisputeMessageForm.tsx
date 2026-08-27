"use client";
import { FormEvent, useState } from "react";

export default function DisputeMessageForm({ disputeId, canPostInternal }: { disputeId: number; canPostInternal: boolean }) {
  const [state, setState] = useState("");
  const [internal, setInternal] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") || "").trim();
    if (!body) return;
    setState("Sending…");
    const res = await fetch(`/api/disputes/${disputeId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, ...(canPostInternal ? { audience: internal ? "internal" : "parties" } : {}) }),
    });
    if (res.ok) {
      location.reload();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not send.");
    }
  }

  return (
    <form className="caseform" onSubmit={submit} style={{ marginTop: 16 }}>
      <label className="wide">
        Message
        <textarea name="body" required minLength={1} placeholder="Add a reply to this case…" />
      </label>
      {canPostInternal && (
        <label>
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} style={{ width: "auto", display: "inline-block", marginRight: 8 }} />
          Internal note (staff only)
        </label>
      )}
      <button>Post message</button>
      <small>{state}</small>
    </form>
  );
}
