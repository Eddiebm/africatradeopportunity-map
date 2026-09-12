"use client";
import { useEffect, useMemo, useState } from "react";
import { africaCountries } from "../../lib/africa-countries";
import { MONTH_NAMES, type ClaimStatus } from "../../lib/intelligence/types";
import type { CountryDesk, DeskCard } from "../../lib/intelligence/desk";

const HOMES = africaCountries.map(([name]) => name);

function statusLabel(status: ClaimStatus): string {
  switch (status) {
    case "quote":
      return "Quote";
    case "official_print":
      return "Official print";
    case "research_calendar":
      return "Research calendar";
    case "partner_share":
      return "Partner share";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function CardList({
  title,
  kicker,
  cards,
  tone,
  home,
}: {
  title: string;
  kicker: string;
  cards: DeskCard[];
  tone: "buy" | "sell" | "avoid";
  home: string;
}) {
  return (
    <section className={`gdesk-col ${tone}`}>
      <div className="gdesk-colhead">
        <p>{kicker}</p>
        <h2>{title}</h2>
        <span>{cards.length} sourced for this month</span>
      </div>
      {cards.length ? cards.map((card) => (
        <article key={card.id}>
          <small>HS {card.hsCode} · {card.monthLabel} · {statusLabel(card.status)}</small>
          <h3>{card.headline}</h3>
          <p>{card.why}</p>
          <p className="measured"><b>Measured:</b> {card.measured}</p>
          <p className="watch"><b>Watch:</b> {card.watch}</p>
          <ul className="sources">
            {card.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
                <span>{source.publisher} · as of {source.asOf}{source.coverage ? ` · ${source.coverage}` : ""}</span>
              </li>
            ))}
          </ul>
          <a href={`/deal/new?product=${encodeURIComponent(card.product)}&hs=${card.hsCode}&origin=${encodeURIComponent(card.origin || card.countries[0])}&destination=${encodeURIComponent(card.destination || home)}`}>Open investigation →</a>
        </article>
      )) : <div className="gdesk-empty">{tone === "avoid" ? "No additional no-go beyond the legal screens on this home." : "No sourced perishable window this month. Empty is the finished desk — not a missing country."}</div>}
    </section>
  );
}

export default function Intelligence() {
  const nowMonth = new Date().getUTCMonth() + 1;
  const [home, setHome] = useState("Ghana");
  const [month, setMonth] = useState(nowMonth);
  const [stance, setStance] = useState("all");
  const [desk, setDesk] = useState<CountryDesk | null>(null);
  const [state, setState] = useState("Loading country desk…");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("home");
    if (wanted && (HOMES as readonly string[]).includes(wanted)) setHome(wanted);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    setState(`Refreshing ${home} desk…`);
    const params = new URLSearchParams({ home, month: String(month), stance });
    fetch(`/api/intelligence?${params}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: CountryDesk) => {
        setDesk(d);
        setState("");
        const next = new URL(window.location.href);
        next.searchParams.set("home", d.home);
        window.history.replaceState(null, "", next);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setState("Desk unavailable. Try again.");
      });
    return () => ac.abort();
  }, [ready, home, month, stance]);

  const counts = useMemo(() => ({
    buy: desk?.buy.length || 0,
    sell: desk?.sell.length || 0,
    avoid: desk?.avoid.length || 0,
  }), [desk]);

  return (
    <main className="gdesk">
      <header>
        <div className="brand">
          <i>TS</i>
          <span><b>TradeSafe Africa</b><small>{home} intelligence desk</small></span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/opportunities">Finder</a>
          <a href="/marketplace">Matches</a>
          <a href="/dashboard">Desk</a>
        </nav>
      </header>
      <section className="gdesk-hero">
        <div>
          <p>IF YOU LIVE IN {home.toUpperCase()}</p>
          <h1>
            {desk && counts.buy + counts.sell === 0
              ? "Legal screens for this home. No sourced harvest calendar."
              : "Consider this product, from these countries, in these months."}
          </h1>
          <span>{desk?.lead || `Sourced screens only for a ${home}-resident trader. Not a quote.`}</span>
        </div>
        <form>
          <label className="home">
            You live in
            <select value={home} onChange={(e) => setHome(e.target.value)}>
              {HOMES.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Stance
            <select value={stance} onChange={(e) => setStance(e.target.value)}>
              <option value="all">Buy, sell and avoid</option>
              <option value="buy">I want to buy into {home}</option>
              <option value="sell">I want to sell from {home}</option>
              <option value="avoid">Show documented no-gos</option>
            </select>
          </label>
          <aside>
            <b>{counts.buy}</b><small>buy now</small>
            <b>{counts.sell}</b><small>sell now</small>
            <b>{counts.avoid}</b><small>do not move</small>
          </aside>
        </form>
      </section>
      {state && <p className="gdesk-state">{state}</p>}
      {desk && (
        <div className="gdesk-grid">
          {(stance === "all" || stance === "buy") && <CardList title={`Buy into ${home}`} kicker="SOURCING" cards={desk.buy} tone="buy" home={home} />}
          {(stance === "all" || stance === "sell") && <CardList title={`Sell from ${home}`} kicker="OFFTAKE" cards={desk.sell} tone="sell" home={home} />}
          {(stance === "all" || stance === "avoid") && <CardList title="Documented no-go" kicker="DO NOT MOVE" cards={desk.avoid} tone="avoid" home={home} />}
        </div>
      )}
      <footer className="gdesk-note">
        <b>{desk?.disclaimer || ""}</b>
        <span>{desk ? `${desk.sourcedCount} sourced claims on this home. All 54 African homes ship. Empty buy/sell means no publication named a flow — not an unfinished file.` : ""}</span>
      </footer>
    </main>
  );
}
