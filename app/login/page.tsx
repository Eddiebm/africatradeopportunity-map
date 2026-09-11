"use client";
import { FormEvent, useEffect, useState } from "react";

function returnTo(): string {
  if (typeof window === "undefined") return "/dashboard";
  const value = new URLSearchParams(window.location.search).get("return_to");
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export default function Login() {
  const [state, setState] = useState("");
  const [dest, setDest] = useState("/dashboard");
  useEffect(() => setDest(returnTo()), []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("Signing in…");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const data = (await res.json()) as { error?: string };
    if (res.ok) {
      window.location.href = dest;
    } else {
      setState(data.error || "Sign in failed.");
    }
  }

  return (
    <main className="portal">
      {/* WCAG 2.4.1 Bypass Blocks — found via a real keyboard-only pass
          (Tab landed on header nav before the sign-in form). Visually
          hidden until focused; see app/globals.css's .skip-link. */}
      <a className="skip-link" href="#signin-form">Skip to sign-in form</a>
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Sign in</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/register">Create account</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>ACCOUNT ACCESS</p>
          <h1>Sign in to your trade desk</h1>
        </div>
      </section>
      {/* tabIndex={-1} makes this a valid skip-link target — without it,
          a <form> isn't natively focusable and the browser wouldn't
          actually move keyboard focus here on activation. */}
      <form id="signin-form" tabIndex={-1} className="dealform" onSubmit={submit} style={{ gridTemplateColumns: "1fr" }}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" minLength={10} />
        </label>
        <button type="submit">Sign in →</button>
        <strong>{state}</strong>
        <span style={{ fontSize: 11 }}>
          <a href="/forgot-password">Forgot your password?</a> · No account? <a href="/register">Register</a>
        </span>
      </form>
    </main>
  );
}
