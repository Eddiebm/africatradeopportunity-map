"use client";
import { FormEvent, useState } from "react";
import Script from "next/script";

// Public site key for the Cloudflare Turnstile widget. Build-time only
// (inlined via NEXT_PUBLIC_* — see vinext's env handling), empty by default.
// No real Turnstile site is provisioned in this environment (no Cloudflare
// dashboard access), so this defaults to "" and the widget below simply
// doesn't render — the form still works, consistent with lib/turnstile.ts's
// fail-open-when-unconfigured decision on the server side. Once a real
// widget exists (dash.cloudflare.com -> Turnstile), set
// NEXT_PUBLIC_TURNSTILE_SITE_KEY at build time to turn it on.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function Register() {
  const [state, setState] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("Creating your account…");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        displayName: form.get("displayName"),
        termsAccepted: form.get("termsAccepted") === "on",
        // Cloudflare Turnstile injects this hidden input into the form
        // itself once the widget below renders and the visitor completes
        // the challenge; empty/absent when no site key is configured.
        turnstileToken: form.get("cf-turnstile-response") || undefined,
        // Priority 11 (docs/production-readiness.md): a referral code
        // carried from app/r/[code]/page.tsx's "Register" link, if this
        // visitor arrived via one — undefined (not attributed) otherwise.
        ref: new URLSearchParams(window.location.search).get("ref") || undefined,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (res.ok) {
      window.location.href = "/dashboard";
    } else {
      setState(data.error || "Registration failed.");
    }
  }

  return (
    <main className="portal">
      <a className="skip-link" href="#register-form">Skip to registration form</a>
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Create account</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/login">Sign in</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>NEW TRADER ACCOUNT</p>
          <h1>Open your trade desk</h1>
        </div>
      </section>
      <form id="register-form" tabIndex={-1} className="dealform" onSubmit={submit} style={{ gridTemplateColumns: "1fr" }}>
        <label>
          Full name
          <input name="displayName" required autoComplete="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="new-password" minLength={10} />
          <small style={{ display: "block", marginTop: 4, fontWeight: "normal", textTransform: "none" }}>
            At least 10 characters.
          </small>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
          <input name="termsAccepted" type="checkbox" required style={{ width: "auto" }} />
          I agree to the <a href="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a> and{" "}
          <a href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
        </label>
        {TURNSTILE_SITE_KEY && (
          <>
            {/* Requires "https://challenges.cloudflare.com" added to the
               CSP's script-src and frame-src in proxy.ts — not done in this
               change; the widget will not load until that lands. */}
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
            <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} />
          </>
        )}
        <button type="submit">Create account →</button>
        <strong>{state}</strong>
        <span style={{ fontSize: 11 }}>
          Already have an account? <a href="/login">Sign in</a>
        </span>
      </form>
    </main>
  );
}
