"use client";
import { FormEvent, useState } from "react";

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
      <form className="dealform" onSubmit={submit} style={{ gridTemplateColumns: "1fr" }}>
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
        <button type="submit">Create account →</button>
        <strong>{state}</strong>
        <span style={{ fontSize: 11 }}>
          Already have an account? <a href="/login">Sign in</a>
        </span>
      </form>
    </main>
  );
}
