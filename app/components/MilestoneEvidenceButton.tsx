"use client";
import { useState } from "react";

export default function MilestoneEvidenceButton({ dealId, milestoneId, evidenceStatus }: { dealId: number; milestoneId: number; evidenceStatus: string }) {
  const [state, setState] = useState("");
  if (evidenceStatus !== "missing") {
    return <small>{evidenceStatus === "verified" ? "Evidence verified" : "Awaiting administrator review"}</small>;
  }
  async function submit() {
    setState("Submitting…");
    const res = await fetch(`/api/deals/${dealId}/milestones/${milestoneId}`, { method: "PATCH" });
    if (res.ok) {
      location.reload();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not submit.");
    }
  }
  return (
    <span>
      <button onClick={submit}>Submit evidence</button>
      {state && <small style={{ marginLeft: 8 }}>{state}</small>}
    </span>
  );
}
