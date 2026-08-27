"use client";
import { useEffect, useRef, useState } from "react";

export default function NewDeal() {
  const [state, setState] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  // One idempotency key per in-progress "create deal" attempt (docs/AUDIT.md
  // §5 item 8) — reused across a resubmit of the SAME attempt so a
  // double-click or a retried request replays the original result instead
  // of creating a second deal room. Rotated on failure so a genuinely new
  // attempt (after fixing a validation error) still gets its own key; a
  // successful submit navigates away, so there's no "next attempt" on this
  // page to rotate for.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(()=>{const form=formRef.current;if(!form)return;const query=new URLSearchParams(location.search);for(const key of ["product","hs","origin","destination"]){const value=query.get(key);const name=key==="hs"?"hsCode":key;const field=form.elements.namedItem(name) as HTMLInputElement|null;if(field&&value)field.value=value}},[]);
  async function submit(formData: FormData) {
    setState("Creating the deal room…");
    const body = Object.fromEntries(formData.entries());
    const response = await fetch("/api/deals", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body) });
    const result = await response.json() as { deal?: { id: number }, error?: string };
    if (result.deal) location.href = `/deal/${result.deal.id}`;
    else { setState(result.error || "The deal could not be created."); setIdempotencyKey(crypto.randomUUID()); }
  }
  return <main className="portal"><header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>New deal intake</small></span></div><nav><a href="/">Map</a><a href="/dashboard">My deals</a></nav></header>
    <section className="portalhead"><div><p>DEAL INTAKE</p><h1>What are you trying to move?</h1></div><aside>Start with a real requirement. Every figure can be verified later.</aside></section>
    <form className="dealform" action={submit} ref={formRef}>
      <label>I want to<select name="requestType" required><option value="buy">Buy</option><option value="sell">Sell</option><option value="move">Move freight</option></select></label>
      <label>Product<input name="product" required placeholder="e.g. Onions, grade A" /></label>
      <label>HS code<input name="hsCode" placeholder="e.g. 0703" /></label>
      <label>Origin country<input name="origin" required placeholder="Burkina Faso" /></label>
      <label>Destination country<input name="destination" required placeholder="Ghana" /></label>
      <label>Quantity<input name="quantity" type="number" min="0" step="any" /></label>
      <label>Unit<select name="unit"><option>tonnes</option><option>kilograms</option><option>truckloads</option><option>units</option><option>heads</option></select></label>
      <label>Needed by<input name="targetDate" type="date" /></label>
      <fieldset><legend>Initial economics</legend>
        <label>Supplier cost<input name="supplierCost" type="number" min="0" step="any" /></label><label>Expected buyer value<input name="expectedRevenue" type="number" min="0" step="any" /></label>
        <label>Freight<input name="freight" type="number" min="0" step="any" /></label><label>Duty, VAT and border<input name="borderTaxes" type="number" min="0" step="any" /></label>
        <label>Finance and FX<input name="financeFx" type="number" min="0" step="any" /></label><label>Loss / spoilage %<input name="lossPercent" type="number" min="0" step="any" /></label>
      </fieldset>
      <button type="submit">Create protected deal room →</button><strong>{state}</strong>
    </form>
  </main>;
}
