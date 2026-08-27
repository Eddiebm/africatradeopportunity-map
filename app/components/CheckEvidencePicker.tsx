"use client";
import { useState } from "react";

export default function CheckEvidencePicker({ dealId, checkId, files }: { dealId: number; checkId: number; files: { id: number; originalName: string }[] }) {
  const [state, setState] = useState("");
  async function attach(documentFileId: number) {
    if (!documentFileId) return;
    setState("Attaching…");
    const res = await fetch(`/api/deals/${dealId}/checks/${checkId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentFileId }),
    });
    if (res.ok) {
      location.reload();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not attach evidence.");
    }
  }
  if (!files.length) return <small>No uploaded documents yet</small>;
  return (
    <span>
      <select defaultValue="" onChange={(e) => attach(Number(e.target.value))}>
        <option value="" disabled>Attach evidence…</option>
        {files.map((f) => <option key={f.id} value={f.id}>{f.originalName}</option>)}
      </select>
      {state && <small style={{ marginLeft: 8 }}>{state}</small>}
    </span>
  );
}
