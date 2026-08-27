"use client";
import { useState } from "react";

type Org = { id: number; legalName: string; myRole: string };

export default function QuoteRequestForm({ dealId, myOrganizations }: { dealId: number; myOrganizations: Org[] }) {
  const [state, setState] = useState("");

  if (!myOrganizations.length) {
    return (
      <p className="quotenote">
        Requesting a quote requires an organization. <a href="/organizations">Create or join one</a> first.
      </p>
    );
  }

  async function submit(formData: FormData) {
    setState("Sending request…");
    const body = Object.fromEntries(formData.entries());
    const res = await fetch(`/api/deals/${dealId}/quote-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string };
    if (res.ok) {
      setState("Quote requested.");
      location.reload();
    } else {
      setState(data.error || "Could not request a quote.");
    }
  }

  return (
    <form className="dealform" action={submit} style={{ margin: "0 0 20px" }}>
      <label>
        Requesting as
        <select name="requesterOrganizationId" required defaultValue="">
          <option value="" disabled>
            Choose your organization
          </option>
          {myOrganizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.legalName} ({org.myRole.replaceAll("_", " ")})
            </option>
          ))}
        </select>
      </label>
      <label>
        Counterparty organization (verified only)
        <input name="recipientOrganizationName" required placeholder="Exact or partial legal name" />
      </label>
      <label>
        Quote type
        <select name="quoteType" required defaultValue="">
          <option value="" disabled>
            Choose
          </option>
          <option value="buy">Buy (I&apos;m purchasing)</option>
          <option value="sell">Sell (I&apos;m supplying)</option>
          <option value="freight">Freight</option>
        </select>
      </label>
      <label>
        Needed by
        <input name="dueAt" type="date" />
      </label>
      <button type="submit">Request quote →</button>
      <strong>{state}</strong>
    </form>
  );
}
