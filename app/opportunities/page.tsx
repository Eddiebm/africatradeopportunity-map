"use client";
import { useEffect, useState, type FormEvent } from "react";
import { africaCountries } from "../../lib/africa-countries";
import { MONTH_NAMES } from "../../lib/intelligence/types";
import type { OpportunityPack, ParsedOrder } from "../../lib/opportunities/types";

const HOMES: string[] = africaCountries.map(([name]) => name);

function roleLabel(role: string): string {
  switch (role) {
    case "wanted":
      return "Wanted";
    case "for_sale":
      return "For sale";
    case "freight_available":
      return "Freight";
    default:
      return role.replaceAll("_", " ");
  }
}

export default function Opportunities() {
  const nowMonth = new Date().getUTCMonth() + 1;
  const [home, setHome] = useState("Ghana");
  const [month, setMonth] = useState(nowMonth);
  const [pack, setPack] = useState<OpportunityPack | null>(null);
  const [state, setState] = useState("Loading country opportunities…");
  const [signedIn, setSignedIn] = useState(false);
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ParsedOrder | null>(null);
  const [pasteState, setPasteState] = useState("");

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("home");
    if (wanted && HOMES.includes(wanted)) setHome(wanted);
    fetch("/api/auth/me")
      .then((response) => setSignedIn(response.ok))
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    setState("Loading country opportunities…");
    fetch(`/api/opportunities?home=${encodeURIComponent(home)}&month=${month}`)
      .then((response) => response.json())
      .then((body: OpportunityPack) => {
        setPack(body);
        setState("");
      })
      .catch(() => setState("Opportunity desk is temporarily unavailable."));
  }, [home, month]);

  async function readPaste(event: FormEvent) {
    event.preventDefault();
    setPasteState("Reading…");
    const response = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "parse", text: paste, home }),
    });
    const body = await response.json() as { parsed?: ParsedOrder; error?: string };
    if (!response.ok || !body.parsed) {
      setPasteState(body.error || "Could not read that text.");
      return;
    }
    setParsed(body.parsed);
    setPasteState(body.parsed.notes[0] || "Check the fields, then post for verification.");
  }

  async function submitPaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedIn) {
      location.href = "/signin?return_to=/opportunities";
      return;
    }
    setPasteState("Posting…");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        text: paste,
        home,
        role: String(form.get("role") || ""),
        product: String(form.get("product") || ""),
        origin: String(form.get("origin") || ""),
        destination: String(form.get("destination") || ""),
        volume: String(form.get("volume") || ""),
        targetPrice: String(form.get("targetPrice") || ""),
        contact: String(form.get("contact") || ""),
      }),
    });
    if (response.status === 401) {
      location.href = "/signin?return_to=/opportunities";
      return;
    }
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      setPasteState(body.error || "Complete every field.");
      return;
    }
    setPasteState("Listed pending verification. Contact stays private.");
    setPaste("");
    setParsed(null);
    const next = await fetch(`/api/opportunities?home=${encodeURIComponent(home)}&month=${month}`).then((r) => r.json()) as OpportunityPack;
    setPack(next);
  }

  return (
    <main className="finder">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Opportunity Finder</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/intelligence">Country desks</a>
          <a href="/marketplace">Matches</a>
          <a href="/dashboard">My deals</a>
        </nav>
      </header>

      <section className="finderhead">
        <div>
          <p>ONE COUNTRY · FOUR LAYERS</p>
          <h1>What can {home} trade this month?</h1>
          <span>
            Live orders are only what a trader posted or pasted. Research windows come from named publications.
            Public boards are official sites you open yourself. WhatsApp groups are not readable from this app.
          </span>
        </div>
        <form>
          <label>
            Home country
            <select value={home} onChange={(e) => setHome(e.target.value)}>
              {HOMES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}
            </select>
          </label>
        </form>
      </section>

      <section className="finder-paste">
        <div>
          <p>WHATSAPP / MARKET NOTE</p>
          <h2>Paste an order. Do not scrape a group.</h2>
          <span>
            Informal bids live in private chats. If a trader forwards a message, we can file it for verification.
            We cannot log into WhatsApp, Facebook, Jiji or a broker’s group on your behalf.
          </span>
        </div>
        <form onSubmit={readPaste}>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Need 20 tonnes onions from Burkina Faso to Ghana. Call 024…"
            rows={5}
            required
          />
          <button type="submit">Read this order</button>
        </form>
        {parsed && (
          <form className="finder-parsed" onSubmit={submitPaste}>
            <label>Type
              <select name="role" defaultValue={parsed.role}>
                <option value="wanted">Wanted</option>
                <option value="for_sale">For sale</option>
                <option value="freight_available">Freight available</option>
              </select>
            </label>
            <label>Product<input name="product" defaultValue={parsed.product} required /></label>
            <label>Origin<input name="origin" defaultValue={parsed.origin} required /></label>
            <label>Destination<input name="destination" defaultValue={parsed.destination} required /></label>
            <label>Volume<input name="volume" defaultValue={parsed.volume} required /></label>
            <label>Price note<input name="targetPrice" defaultValue={parsed.targetPrice} /></label>
            <label>Private contact<input name="contact" defaultValue={parsed.contact} required placeholder="Phone or email" /></label>
            <button type="submit">{signedIn ? "Post for verification" : "Sign in to post"}</button>
          </form>
        )}
        {pasteState && <strong>{pasteState}</strong>}
      </section>

      {state && <p className="finder-state">{state}</p>}

      {pack && (
        <>
          <section className="finder-layer">
            <div className="layerhead">
              <p>LAYER 1 · LIVE ORDERS ON THIS SITE</p>
              <h2>{pack.liveListings.length} listings touching {pack.home}</h2>
            </div>
            {pack.liveListings.length ? pack.liveListings.map((row) => (
              <article key={row.id}>
                <div>
                  <i>{roleLabel(row.role)}</i>
                  <b className={row.status === "verified" ? "verified" : "pending"}>{row.status.replaceAll("_", " ")}</b>
                </div>
                <h3>{row.product}</h3>
                <p>{row.origin} → {row.destination}</p>
                <strong>{row.volume}</strong>
                <a href="/marketplace">Request introduction →</a>
              </article>
            )) : (
              <div className="findempty">
                <b>No live order for {pack.home} yet.</b>
                <span>That empty list is correct. Paste a WhatsApp note above or post a classified from the Atlas.</span>
              </div>
            )}
          </section>

          <section className="finder-layer">
            <div className="layerhead">
              <p>LAYER 2 · RESEARCH WINDOWS · {pack.monthName.toUpperCase()}</p>
              <h2>{pack.researchWindows.length} sourced buy/sell notes</h2>
            </div>
            {pack.researchWindows.length ? pack.researchWindows.map((card) => (
              <article key={card.id} className={card.stance}>
                <small>HS {card.hsCode} · {card.monthLabel} · {card.stance}</small>
                <h3>{card.headline}</h3>
                <p>{card.why}</p>
                <p><b>Measured:</b> {card.measured}</p>
                <ul>
                  {card.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
                      <span> as of {source.asOf}</span>
                    </li>
                  ))}
                </ul>
                <a href={`/deal/new?product=${encodeURIComponent(card.product)}&hs=${card.hsCode}&origin=${encodeURIComponent(card.origin || pack.home)}&destination=${encodeURIComponent(card.destination || pack.home)}`}>Open investigation →</a>
              </article>
            )) : (
              <div className="findempty">
                <b>No sourced buy or sell window for {pack.home} in {pack.monthName}.</b>
                <span>Empty is the desk. Legal avoid-notes still appear below if a publication supports them.</span>
              </div>
            )}
          </section>

          {pack.avoidNotes.length > 0 && (
            <section className="finder-layer avoid">
              <div className="layerhead">
                <p>NOT AN OPPORTUNITY</p>
                <h2>{pack.avoidNotes.length} documented no-go{pack.avoidNotes.length === 1 ? "" : "s"}</h2>
              </div>
              {pack.avoidNotes.map((note) => (
                <article key={note.id}>
                  <h3>{note.headline}</h3>
                  <p>{note.why}</p>
                </article>
              ))}
            </section>
          )}

          {pack.referenceLanes.length > 0 && (
            <section className="finder-layer">
              <div className="layerhead">
                <p>LAYER 3 · REFERENCE LANES</p>
                <h2>Screening prices — not offers</h2>
              </div>
              {pack.referenceLanes.map((lane) => (
                <article key={lane.hsCode + lane.origin + lane.destination}>
                  <small>HS {lane.hsCode} · {lane.unit}</small>
                  <h3>{lane.product}</h3>
                  <p>{lane.origin} → {lane.destination}</p>
                  <strong>{lane.signal}</strong>
                  <a href={`/?origin=${encodeURIComponent(lane.origin)}&destination=${encodeURIComponent(lane.destination)}`}>Price on Atlas →</a>
                </article>
              ))}
            </section>
          )}

          <section className="finder-layer boards">
            <div className="layerhead">
              <p>LAYER 4 · PUBLIC PLACES ORDERS ARE POSTED</p>
              <h2>Open these. This app does not scrape them.</h2>
            </div>
            {pack.publicBoards.map((board) => (
              <article key={board.id}>
                <small>{board.coverage} · {board.publisher}</small>
                <h3>{board.name}</h3>
                <p>{board.whatYouFind}</p>
                <a href={board.url} target="_blank" rel="noreferrer">Open board ↗</a>
              </article>
            ))}
          </section>

          <footer className="findnote">
            <b>{pack.disclaimer}</b>
            A quote is only binding when a verified counterparty submits it on this site.
          </footer>
        </>
      )}
    </main>
  );
}
