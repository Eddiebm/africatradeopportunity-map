"use client";
import { useEffect, useState } from "react";
import { formatCurrency } from "../../lib/i18n/format";

type Entry = { id: number; componentType: string; expectedAmount: number; lowAmount: number | null; highAmount: number | null; currency: string; source: string; confidence: string; assumptions: string; sourceDate: string | null };
type Component = { componentType: string; estimate: Entry | null; actual: Entry | null; variance: number | null };
type Breakdown = { components: Component[]; excluded: Entry[]; totals: { low: number | null; expected: number; high: number | null }; actualTotal: number | null; overallConfidence: string | null };

const COMPONENT_TYPES = ["goods", "transport", "insurance", "duties_taxes", "brokerage", "inspection", "financing", "tradesafe_fees", "other"];

// Priority 12 (docs/production-readiness.md): "per cost component: amount,
// currency, source, retrieval date, verified/estimated status,
// assumptions, confidence ... low/expected/high estimates, unknown/
// excluded costs ... after delivery, record actuals and calculate
// variance." This is the itemized, sourced detail BEHIND the deal room's
// existing top-line landed-cost figure (unchanged, still driven by
// dealCosts/quotes — see app/deal/[id]/page.tsx) — never a replacement
// for it, an additional layer of honesty on top.
export default function LandedCostBreakdown({ dealId, currency, isOwner }: { dealId: number; currency: string; isOwner: boolean }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [state, setState] = useState("Loading landed-cost detail…");

  async function load() {
    const r = await fetch(`/api/deals/${dealId}/landed-cost`);
    if (r.ok) {
      setData((await r.json()) as Breakdown);
      setState("");
    } else {
      setState("Landed-cost detail unavailable.");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function recordActual(formData: FormData) {
    setState("Saving…");
    const body = Object.fromEntries(formData.entries());
    const res = await fetch(`/api/deals/${dealId}/landed-cost`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, phase: "actual" }),
    });
    if (res.ok) {
      await load();
    } else {
      const d = (await res.json()) as { error?: string };
      setState(d.error || "Could not save.");
    }
  }

  if (state && !data) return <p>{state}</p>;
  if (!data) return null;

  return (
    <div>
      <div className="roomtitle"><small>LANDED-COST BREAKDOWN</small><b>{data.overallConfidence ? `${data.overallConfidence} confidence` : "No estimate on file"}</b></div>
      {data.components.map((c) => (
        <div className="task" key={c.componentType}>
          <i>{c.actual ? "✓" : "—"}</i>
          <span>
            <b>{c.componentType.replaceAll("_", " ")}</b>
            <small>
              {c.estimate ? (
                <>
                  Estimate: {c.estimate.lowAmount != null ? `${formatCurrency(c.estimate.lowAmount, c.estimate.currency)}–` : ""}
                  {formatCurrency(c.estimate.expectedAmount, c.estimate.currency)}
                  {c.estimate.highAmount != null ? `–${formatCurrency(c.estimate.highAmount, c.estimate.currency)}` : ""}
                  {" "}({c.estimate.confidence} confidence · {c.estimate.source || "source not stated"}{c.estimate.sourceDate ? `, ${c.estimate.sourceDate}` : ""})
                </>
              ) : "No estimate on file"}
              {c.actual && <> · Actual: <b>{formatCurrency(c.actual.expectedAmount, c.actual.currency)}</b> ({c.actual.source})</>}
              {c.variance != null && (
                <> · Variance: <b className={c.variance > 0 ? "negative" : c.variance < 0 ? "positive" : ""}>{c.variance > 0 ? "+" : ""}{formatCurrency(c.variance, c.actual?.currency || currency)}</b> vs. estimate</>
              )}
            </small>
          </span>
        </div>
      ))}
      {data.excluded.length > 0 && (
        <>
          <div className="roomtitle" style={{ marginTop: 16 }}><small>NOT YET ESTIMATED</small><b>{data.excluded.length} component(s) excluded from totals</b></div>
          {data.excluded.map((e) => (
            <div className="task" key={e.componentType}><i>?</i><span><b>{e.componentType.replaceAll("_", " ")}</b><small>{e.source}</small></span></div>
          ))}
        </>
      )}
      <div className="task" style={{ borderTop: "2px solid #173c31", marginTop: 8 }}>
        <i>Σ</i>
        <span>
          <b>Total (excludes items above marked &quot;not yet estimated&quot;)</b>
          <small>
            {data.totals.low != null ? `${formatCurrency(data.totals.low, currency)}–` : "Low: unknown · "}
            {formatCurrency(data.totals.expected, currency)}
            {data.totals.high != null ? `–${formatCurrency(data.totals.high, currency)}` : " · High: unknown"}
            {data.actualTotal != null && <> · Actual total: <b>{formatCurrency(data.actualTotal, currency)}</b></>}
          </small>
        </span>
      </div>
      {isOwner && (
        <form className="dealform" style={{ margin: "14px 0", gridTemplateColumns: "1fr 1fr 1fr 1fr" }} action={recordActual}>
          <label>
            Component
            <select name="componentType" required defaultValue="">
              <option value="" disabled>After delivery, record an actual…</option>
              {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>Actual amount<input name="expectedAmount" type="number" min="0" step="any" required /></label>
          <label>Source<input name="source" placeholder="e.g. paid invoice #123" required /></label>
          <button type="submit">Record actual →</button>
        </form>
      )}
      {state && <strong>{state}</strong>}
    </div>
  );
}
