"use client";
import { useState } from "react";

// Priority 9 (docs/production-readiness.md): "Design a low-friction quote
// request flow ... No full account creation required before preliminary
// value; authentication required before revealing counterparties,
// protected introductions, sensitive documents, or private information."
//
// This page collects exactly the mission's field list — product,
// quantity/unit, spec, origin if known, destination, required delivery
// date, an existing supplier quotation (if any, as text — see
// db/schema.ts's marketRequests.existingQuoteNote comment for why not a
// file upload), preferred contact method, consent — and submits to the
// SAME public POST /api/market-requests route the homepage's classifieds
// form already uses (role:"quote_request" distinguishes this low-friction
// path from that denser listing tool), reusing the existing Turnstile
// anti-abuse gate rather than a new one. No login, no session, no
// organization required. What happens after submission stays limited to a
// confirmation and an OPTIONAL invitation to create an account — nothing
// here reveals a counterparty, a document, or any other protected detail;
// those stay behind the existing auth-gated routes untouched by this page.
export default function QuoteRequest() {
  const [state, setState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function submit(formData: FormData) {
    setSubmitting(true);
    setState("Sending your request…");
    const body = Object.fromEntries(formData.entries());
    try {
      // Priority 11 (docs/production-readiness.md): a referral code
      // carried from app/r/[code]/page.tsx's "Continue" link, if this
      // visitor arrived via one.
      const ref = new URLSearchParams(window.location.search).get("ref") || undefined;
      const res = await fetch("/api/market-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, role: "quote_request", ref }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setConfirmed(true);
        setState("");
      } else {
        setState(data.error || "Could not send your request. Please try again.");
      }
    } catch {
      setState("Could not send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <main className="quotepage">
        <header>
          <div><b>TradeSafe Africa</b></div>
          <a href="/">Home</a>
        </header>
        <section className="quoteconfirm">
          <h2>Request received.</h2>
          <p>
            A member of the TradeSafe team will review your request and follow up using the contact you
            provided. This is a preliminary request, not a quote, a guarantee, or a verified transaction —
            real costs are confirmed once a counterparty and evidence are in place.
          </p>
          <p>
            Creating a free account lets you track this request, see your landed-cost estimate build up in
            one place, and — once counterparties are verified — view protected introductions and secure
            documents. None of that is required to have submitted this request.
          </p>
          <a href="/register">Create a free account</a>
          <a className="secondary" href="/">Continue browsing</a>
        </section>
      </main>
    );
  }

  return (
    <main className="quotepage">
      <header>
        <div><b>TradeSafe Africa</b></div>
        <a href="/">Home</a>
      </header>
      <section className="quotehero">
        <p>GET A QUOTE</p>
        <h1>Know your complete landed cost before sending money.</h1>
        <span>
          Tell us what you need. No account required to send this request — we&apos;ll follow up with a real,
          itemized cost picture before you commit to anything.
        </span>
      </section>
      <form className="quoteform" action={submit}>
        <label>
          Product <input name="product" required placeholder="e.g. Parboiled rice, 50kg bags" />
        </label>
        <div className="quoterow">
          <label>
            Quantity <input name="quantity" type="number" min="0" step="any" placeholder="e.g. 20" />
          </label>
          <label>
            Unit
            <select name="unit" defaultValue="">
              <option value="">Not sure yet</option>
              <option>tonnes</option>
              <option>kilograms</option>
              <option>truckloads</option>
              <option>containers</option>
              <option>units</option>
            </select>
          </label>
        </div>
        <label>
          Specification / grade (optional) <textarea name="productSpec" placeholder="Grade, packaging, certifications required, etc." />
        </label>
        <div className="quoterow">
          <label>
            Origin, if known <input name="origin" placeholder="Leave blank if unsure" />
          </label>
          <label>
            Destination <input name="destination" required placeholder="Country or city" />
          </label>
        </div>
        <label>
          Required delivery date (optional) <input name="requiredDeliveryDate" type="date" />
        </label>
        <label>
          Already have a supplier quotation? (optional) <textarea name="existingQuoteNote" placeholder="Paste the key numbers — price, terms, validity. Never paste bank details or identity documents here." />
        </label>
        <div className="quoterow">
          <label>
            Contact (email or phone) <input name="contact" required placeholder="you@example.com" />
          </label>
          <label>
            Preferred contact method
            <select name="preferredContactMethod" defaultValue="email">
              <option value="email">Email</option>
              <option value="phone">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
        </div>
        <label className="consent">
          <input type="checkbox" name="consent" value="yes" required />
          <span>
            I agree that TradeSafe Africa may contact me about this request using the details above. I understand
            this is not a binding quote or a guarantee of a transaction.
          </span>
        </label>
        <button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send my request →"}</button>
        {state && <strong>{state}</strong>}
        <p className="quotenote2">
          Private and identity documents are never requested here. Once your request is reviewed, any
          sensitive information is exchanged only through an authenticated, protected deal room.
        </p>
      </form>
    </main>
  );
}
