"use client";
import { FormEvent, useState } from "react";

export default function ForgotPassword() {
  const [state, setState] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("Checking…");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    setState(data.message || data.error || "Something went wrong.");
  }

  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Reset password</small>
          </span>
        </div>
        <nav>
          <a href="/login">Sign in</a>
        </nav>
      </header>
      <section className="portalhead">
        <div>
          <p>ACCOUNT ACCESS</p>
          <h1>Forgot your password?</h1>
        </div>
      </section>
      <form className="dealform" onSubmit={submit} style={{ gridTemplateColumns: "1fr" }}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <button type="submit">Send reset link →</button>
        <strong>{state}</strong>
      </form>
    </main>
  );
}
