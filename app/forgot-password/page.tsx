"use client";
import { FormEvent, useRef, useState } from "react";
import { TurnstileField, tokenFromTurnstile, type TurnstileFieldHandle } from "../components/TurnstileField";

export default function ForgotPassword() {
  const [state, setState] = useState("");
  const turnstile = useRef<TurnstileFieldHandle>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const turnstileToken = tokenFromTurnstile(turnstile.current, form);
    if (!turnstileToken) {
      setState("Complete the verification checkbox first.");
      return;
    }
    setState("Checking…");
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          turnstileToken,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      turnstile.current?.reset();
      setState(data.message || data.error || "Something went wrong.");
    } catch {
      turnstile.current?.reset();
      setState("Something went wrong.");
    }
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
        <TurnstileField ref={turnstile} action="password-reset" />
        <button type="submit">Send reset link →</button>
        <strong>{state}</strong>
      </form>
    </main>
  );
}
