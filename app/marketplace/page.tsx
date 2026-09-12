"use client";

import { FormEvent, useEffect, useState } from "react";

type Listing = { id: number; role: string; product: string; origin: string; destination: string; volume: string; status: string };
type Suggestion = {
  ownId: number;
  total: number;
  breakdown: { product: number; route: number; verified: number; listingCompleteness: number };
  counterpart: Listing;
};
type Match = {
  id: string;
  score: number;
  status: string;
  demandInterestAt: string | null;
  supplyInterestAt: string | null;
  counterpart: (Listing & { contact: string }) | null;
};
type QuoteRow = {
  id: string;
  matchId: string | null;
  status: string;
  mineIsRequester: boolean;
  requirements: string;
  quote: {
    id: string;
    currency: string;
    unitPrice: number;
    quantity: number;
    unit: string;
    goodsTotal: number;
    freightTotal: number;
    validUntil: string;
    status: string;
  } | null;
};

export default function Marketplace() {
  const [data, setData] = useState<{ mine: Listing[]; suggestions: Suggestion[]; matches: Match[] } | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [state, setState] = useState("Loading your market desk…");

  async function load() {
    const [market, quoteRes] = await Promise.all([fetch("/api/marketplace"), fetch("/api/quotes")]);
    if (market.status === 401) {
      location.href = "/signin?return_to=/marketplace";
      return;
    }
    const marketBody = await market.json();
    const quoteBody = await quoteRes.json();
    if (market.ok) {
      setData(marketBody);
      setQuotes(quoteBody.quotes || []);
      setState("");
    } else setState(marketBody.error || "Marketplace unavailable.");
  }

  useEffect(() => { load(); }, []);

  async function interest(ownId: number, counterpartId: number) {
    setState("Recording interest…");
    const response = await fetch("/api/marketplace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownId, counterpartId }),
    });
    if (response.ok) await load();
    else setState((await response.json()).error);
  }

  async function consent(matchId: string) {
    setState("Recording consent…");
    const response = await fetch("/api/marketplace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    if (response.ok) await load();
    else setState((await response.json()).error);
  }

  async function requestQuote(matchId: string) {
    setState("Requesting quote…");
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request", matchId }),
    });
    if (response.ok) await load();
    else setState((await response.json()).error);
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("Submitting binding quote…");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit", ...Object.fromEntries(form) }),
    });
    if (response.ok) await load();
    else setState((await response.json()).error);
  }

  async function acceptQuote(quoteId: string) {
    setState("Accepting quote and opening deal room…");
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "accept", quoteId }),
    });
    const body = await response.json() as { deal?: { id: number }; error?: string };
    if (body.deal) location.href = `/deal/${body.deal.id}`;
    else if (response.ok) await load();
    else setState(body.error || "Quote could not be accepted.");
  }

  const inboundQuotes = quotes.filter((row) => !row.mineIsRequester && row.status === "requested");

  return (
    <main className="market">
      <header>
        <div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Matching desk</small></span></div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/intelligence">Country desks</a>
          <a href="/dashboard">My deals</a>
          <a href="/deal/new">Open deal</a>
          <a href="/signout">Sign out</a>
        </nav>
      </header>
      <section className="markethead">
        <div>
          <p>LIVE MARKETPLACE</p>
          <h1>Matches that can become deals</h1>
          <span>Verified listings are scored for product and route fit. Contact is released only after mutual interest and administrator review. A quote must be accepted before a deal room opens.</span>
        </div>
        <aside><b>{data?.suggestions.length || 0}</b><span>current suggestions</span></aside>
      </section>
      {state && <div className="marketstate">{state}</div>}
      <section className="marketgrid">
        <article>
          <div className="markettitle"><small>YOUR LISTINGS</small><b>{data?.mine.length || 0}</b></div>
          {data?.mine.length ? data.mine.map((row) => (
            <div className="listing" key={row.id}>
              <span>
                <i>{row.role.replaceAll("_", " ")}</i>
                <b>{row.product}</b>
                <small>{row.origin} → {row.destination} · {row.volume}</small>
              </span>
              <strong className={row.status === "verified" ? "verified" : "pending"}>{row.status.replaceAll("_", " ")}</strong>
            </div>
          )) : (
            <div className="marketempty">
              <b>No owned listings yet</b>
              <p>Post a classified from the Atlas. It stays pending until an administrator verifies it.</p>
              <a href="/#deal-economics">Post a listing →</a>
            </div>
          )}
        </article>
        <article>
          <div className="markettitle"><small>SUGGESTED COUNTERPARTIES</small><b>Fit score</b></div>
          {data?.suggestions.length ? data.suggestions.map((row) => (
            <div className="suggestion" key={`${row.ownId}-${row.counterpart.id}`}>
              <div className="scorebadge">{row.total}</div>
              <span>
                <i>{row.counterpart.role.replaceAll("_", " ")}</i>
                <b>{row.counterpart.product}</b>
                <small>{row.counterpart.origin} → {row.counterpart.destination} · {row.counterpart.volume}</small>
                <em>Product {row.breakdown.product}/40 · Route {row.breakdown.route}/35 · Evidence {row.breakdown.verified}/15</em>
              </span>
              <button onClick={() => interest(row.ownId, row.counterpart.id)}>Express interest</button>
            </div>
          )) : (
            <div className="marketempty">
              <b>No verified fit yet</b>
              <p>A live suggestion needs your listing plus a verified opposite-side listing for the same product and corridor.</p>
            </div>
          )}
        </article>
      </section>
      <section className="matchboard">
        <div className="markettitle"><small>INTRODUCTIONS</small><b>Consent-controlled</b></div>
        {data?.matches.length ? data.matches.map((row) => (
          <article key={row.id}>
            <div>
              <i>{row.id}</i>
              <b>{row.counterpart?.product || "Counterparty listing"}</b>
              <span>{row.counterpart?.origin} → {row.counterpart?.destination}</span>
            </div>
            <strong>{row.status.replaceAll("_", " ")}</strong>
            <p>{row.counterpart?.contact}</p>
            {row.status !== "approved" && row.status !== "quoted" ? <button onClick={() => consent(row.id)}>Confirm my interest</button> : null}
            {(row.status === "mutual_interest" || row.status === "approved") ? <button onClick={() => requestQuote(row.id)}>Request quote</button> : null}
          </article>
        )) : (
          <div className="marketempty">
            <b>No introductions in progress</b>
            <p>Express interest in a suggestion to begin the mutual-consent workflow.</p>
          </div>
        )}
      </section>
      <section className="matchboard quoteboard">
        <div className="markettitle"><small>BINDING QUOTES</small><b>{quotes.length} live</b></div>
        {inboundQuotes.length ? inboundQuotes.map((row) => {
          const need = JSON.parse(row.requirements || "{}") as { product?: string; origin?: string; destination?: string; volume?: string };
          return (
            <form className="quoteform" key={row.id} onSubmit={submitQuote}>
              <input type="hidden" name="quoteRequestId" value={row.id} />
              <div>
                <i>{row.id}</i>
                <b>{need.product || "Goods quote"}</b>
                <span>{need.origin} → {need.destination} · {need.volume}</span>
              </div>
              <label>Unit price<input name="unitPrice" type="number" min="1" step="0.01" required /></label>
              <label>Quantity<input name="quantity" type="number" min="0.01" step="0.01" required /></label>
              <label>Freight<input name="freightTotal" type="number" min="0" step="0.01" defaultValue="0" /></label>
              <label>Valid until<input name="validUntil" type="date" required /></label>
              <button>Send quote</button>
            </form>
          );
        }) : null}
        {quotes.map((row) => {
          const need = JSON.parse(row.requirements || "{}") as { product?: string; origin?: string; destination?: string };
          return (
            <article key={`q-${row.id}`}>
              <div>
                <i>{row.status}</i>
                <b>{need.product || row.id}</b>
                <span>{need.origin} → {need.destination}</span>
              </div>
              <strong>{row.quote ? `${row.quote.currency} ${row.quote.goodsTotal.toLocaleString()}` : "Awaiting price"}</strong>
              <p>{row.quote ? `Valid ${row.quote.validUntil}` : "No offer yet"}</p>
              {row.mineIsRequester && row.quote?.status === "submitted" ? (
                <button onClick={() => acceptQuote(row.quote!.id)}>Accept & open deal</button>
              ) : null}
            </article>
          );
        })}
        {!quotes.length ? (
          <div className="marketempty">
            <b>No quotes yet</b>
            <p>After mutual interest, request a quote. Accepting a still-valid quote opens a protected deal room.</p>
          </div>
        ) : null}
      </section>
      <section className="marketwarning">
        <b>What “verified” means here:</b> an administrator recorded a completed evidence check. It is not insurance, a guarantee of performance, or confirmation that goods or funds exist today. Money must move through a licensed payment partner.
      </section>
    </main>
  );
}
