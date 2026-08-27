"use client";
import { useState } from "react";

export default function QuoteActions({ quoteId }: { quoteId: string }) {
  const [state, setState] = useState("");
  async function decide(status: "accepted" | "declined") {
    setState("Saving…");
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      location.reload();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not save.");
    }
  }
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button onClick={() => decide("accepted")}>Accept quote</button>
      <button className="reject" onClick={() => decide("declined")}>Decline</button>
      {state && <small>{state}</small>}
    </span>
  );
}
