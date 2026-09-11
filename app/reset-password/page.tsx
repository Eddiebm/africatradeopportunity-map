"use client";
import { FormEvent, useEffect, useState } from "react";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [state, setState] = useState("");
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setState("This reset link is missing its token.");
      return;
    }
    setState("Saving…");
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      setState("Passwords do not match.");
      return;
    }
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = (await res.json()) as { error?: string };
    if (res.ok) {
      setState("Password updated. Redirecting to sign in…");
      window.setTimeout(() => (window.location.href = "/login"), 1200);
    } else {
      setState(data.error || "Could not reset password.");
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
          <h1>Choose a new password</h1>
        </div>
      </section>
      <form className="dealform" onSubmit={submit} style={{ gridTemplateColumns: "1fr" }}>
        <label>
          New password
          <input name="password" type="password" required autoComplete="new-password" minLength={10} />
        </label>
        <label>
          Confirm new password
          <input name="confirm" type="password" required autoComplete="new-password" minLength={10} />
        </label>
        <button type="submit">Update password →</button>
        <strong>{state}</strong>
      </form>
    </main>
  );
}
