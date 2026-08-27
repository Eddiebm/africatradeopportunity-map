"use client";
import { useEffect, useMemo, useState } from "react";
import { africaCountries } from "../../lib/africa-countries";
import type { OpportunityCandidate, OpportunitiesResponse } from "../api/opportunities/route";

const usd = (n: number) => n ? new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n) : "No record";
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export default function Opportunities() {
  const [capital, setCapital] = useState(40000), [country, setCountry] = useState("All"), [risk, setRisk] = useState(70);
  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [state, setState] = useState("Loading ranked opportunities from cached UN Comtrade / World Bank demand data…");

  useEffect(() => {
    let cancelled = false;
    setState("Loading ranked opportunities from cached UN Comtrade / World Bank demand data…");
    const params = new URLSearchParams({ capital: String(capital), country, risk: String(risk) });
    fetch(`/api/opportunities?${params}`)
      .then((r) => r.json() as Promise<OpportunitiesResponse & { error?: string }>)
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setState(d.error); setData(null); return; }
        setData(d);
        setState(d.candidates.length ? "" : "No candidate fits these limits.");
      })
      .catch(() => { if (!cancelled) setState("Opportunity data is temporarily unavailable."); });
    return () => { cancelled = true; };
  }, [capital, country, risk]);

  const ranked = useMemo(() => data?.candidates || [], [data]);

  return <main className="finder">
    <header><div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Opportunity Finder</small></span></div><nav><a href="/">Atlas</a><a href="/dashboard">My deals</a><a href="/admin">Verification desk</a></nav></header>
    <section className="finderhead">
      <div><p>DEMAND SIGNAL → SUPPLY EVIDENCE → BUYER EVIDENCE</p><h1>What should I move?</h1><span>Ranked from cached UN Comtrade / World Bank demand data and verified marketplace listings — not fabricated cost or profit figures. Live quotations and a verified buyer are still required before money moves.</span></div>
      <form onSubmit={(e) => e.preventDefault()}>
        <label>Minimum market size ($, recorded annual imports)<input type="number" value={capital} onChange={(e) => setCapital(+e.target.value)} /></label>
        <label>Country<select value={country} onChange={(e) => setCountry(e.target.value)}><option>All</option>{africaCountries.map(([name]) => <option key={name}>{name}</option>)}</select></label>
        <label>Maximum forecast uncertainty<input type="range" min="20" max="90" value={risk} onChange={(e) => setRisk(+e.target.value)} /><i>{risk}/100</i></label>
      </form>
    </section>
    <section className="ranked">
      <div className="rankhead"><span>RANK / OPPORTUNITY</span><span>DEMAND EVIDENCE</span><span>SUPPLY EVIDENCE</span><span>BUYER EVIDENCE</span><span>DECISION</span></div>
      {ranked.length ? ranked.map((x: OpportunityCandidate, i: number) =>
        <article key={`${x.hsCode}-${x.origin}-${x.destination}`}>
          <div><i>#{i + 1}</i><span><b>{x.product}</b><small>HS {x.hsCode} · {x.route} · {x.cacheStatus === "cached" ? "cached" : "live"} lookup</small></span></div>
          <div><b>{x.demand.direction} · {pct(x.demand.growthRate)}</b><small>Forecast {x.demand.nextYear}: {usd(x.demand.forecastValue)} · {x.demand.confidence}% confidence · {x.demand.currentYearMonthsReported} month(s) reported for {x.demand.currentYear}</small></div>
          <div><b>{x.supply.hasRecordedOrigin ? `${(x.supply.originShare * 100).toFixed(1)}% of world imports` : "No African supplier record"}</b><small>{x.supply.hasRecordedOrigin ? `${x.origin} recorded ${usd(x.supply.originValue)}` : "Comtrade returned no African partner record for this corridor."} · World imports {usd(x.supply.worldImports)}</small></div>
          <div><b className={x.buyerEvidence.verifiedBuyerListing ? "positive" : undefined}>{x.buyerEvidence.verifiedBuyerListing ? "Verified buyer listed" : "Promising market—no verified buyer yet."}</b><small>{x.buyerEvidence.verifiedSupplierListing ? "A verified supplier listing also exists at this origin." : "No verified marketplace evidence yet."}</small></div>
          <div><strong>{x.score}</strong><small>/100 · demand {x.breakdown.demand} + supply {x.breakdown.supply} + buyer {x.breakdown.buyerEvidence} + confidence {x.breakdown.forecastConfidence}</small><a href={`/deal/new?product=${encodeURIComponent(x.product)}&hs=${x.hsCode}&origin=${encodeURIComponent(x.origin)}&destination=${encodeURIComponent(x.destination)}`}>Open investigation →</a></div>
        </article>) :
        <div className="findempty"><b>{state || "No candidate fits these limits."}</b><span>Increase the country coverage, lower the minimum market size, or raise the acceptable forecast uncertainty.</span></div>}
    </section>
    <footer className="findnote"><b>Every figure above traces to a cached UN Comtrade or World Bank response, or to a status:&quot;verified&quot; marketplace listing — never a fabricated buy/sell price or landed cost.</b> No cost or profit estimate is shown because none exists yet for these candidates: per-shipment landed cost only becomes real once a quotation is requested (see Quotations in an open deal) or a trader posts their own cost estimate on a specific deal. &quot;Minimum market size&quot; reflects total recorded annual imports for the product and destination — an indicator of market scale, not a cost or profit estimate.</footer>
  </main>;
}
