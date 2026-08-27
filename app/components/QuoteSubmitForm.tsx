"use client";
import { FormEvent, useState } from "react";

export default function QuoteSubmitForm({ quoteRequestId }: { quoteRequestId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("Submitting quote…");
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(form.entries());
    body.inclusions = String(form.get("inclusions") || "").split(",").map((s) => s.trim()).filter(Boolean);
    body.exclusions = String(form.get("exclusions") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const res = await fetch(`/api/quote-requests/${quoteRequestId}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string };
    if (res.ok) {
      setState("Quote submitted.");
      location.reload();
    } else {
      setState(data.error || "Could not submit quote.");
    }
  }

  if (!open) return <button onClick={() => setOpen(true)}>Submit a quote</button>;

  return (
    <form className="dealform" onSubmit={submit} style={{ margin: "12px 0" }}>
      <label>
        Currency<input name="currency" required placeholder="USD" maxLength={6} />
      </label>
      <label>
        Unit<input name="unit" placeholder="tonnes" />
      </label>
      <label>
        Unit price<input name="unitPrice" type="number" min="0" step="any" />
      </label>
      <label>
        Quantity<input name="quantity" type="number" min="0" step="any" />
      </label>
      <label>
        Goods total<input name="goodsTotal" type="number" min="0" step="any" required />
      </label>
      <label>
        Freight total<input name="freightTotal" type="number" min="0" step="any" />
      </label>
      <label>
        Border/duty estimate<input name="borderEstimate" type="number" min="0" step="any" />
      </label>
      <label>
        Inspection<input name="inspectionTotal" type="number" min="0" step="any" />
      </label>
      <label>
        Insurance<input name="insuranceTotal" type="number" min="0" step="any" />
      </label>
      <label>
        Finance/FX<input name="financeFxTotal" type="number" min="0" step="any" />
      </label>
      <label>
        Other<input name="otherTotal" type="number" min="0" step="any" />
      </label>
      <label>
        Valid until<input name="validUntil" type="date" required />
      </label>
      <label>
        Includes (comma-separated)<input name="inclusions" placeholder="loading, standard packaging" />
      </label>
      <label>
        Excludes (comma-separated)<input name="exclusions" placeholder="import permit, final-mile delivery" />
      </label>
      <fieldset>
        <legend>Assumptions</legend>
        <label style={{ gridColumn: "1/4" }}>
          What this quote assumes and does not cover
          <textarea name="assumptions" required rows={3} style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #bcc6bd", background: "#faf9f4" }} />
        </label>
      </fieldset>
      <button type="submit">Submit quote →</button>
      <strong>{state}</strong>
    </form>
  );
}
