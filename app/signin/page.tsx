"use client";

import { FormEvent, useEffect, useState } from "react";

export default function SignInPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, setState] = useState("");
  const [returnTo, setReturnTo] = useState("/dashboard");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("return_to");
    if (value?.startsWith("/") && !value.startsWith("//")) setReturnTo(value);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState(mode === "signin" ? "Signing in…" : "Creating your desk…");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    if (mode === "signup") body.terms = form.get("terms") ? "accepted" : "";
    const response = await fetch(mode === "signin" ? "/api/auth/signin" : "/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string };
    if (response.ok) location.href = returnTo;
    else setState(result.error || "Could not complete sign-in.");
  }

  return (
    <main className="portal">
      <header>
        <div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Live trading desk</small></span></div>
        <nav><a href="/">Atlas</a><a href="/terms">Terms</a></nav>
      </header>
      <section className="portalhead">
        <div>
          <p>ACCOUNT</p>
          <h1>{mode === "signin" ? "Sign in to trade" : "Open a trading account"}</h1>
        </div>
        <aside>Listings, matches, quotes and deal rooms require an account. Verification is evidence review, not a guarantee of performance.</aside>
      </section>
      <form className="dealform authform" onSubmit={submit}>
        {mode === "signup" ? (
          <>
            <label>Full name<input name="displayName" required placeholder="Ama Mensah" /></label>
            <label>Country<input name="country" required placeholder="Ghana" /></label>
          </>
        ) : null}
        <label>Work email<input name="email" type="email" required placeholder="you@company.com" /></label>
        <label>Password<input name="password" type="password" required minLength={8} /></label>
        {mode === "signup" ? (
          <label className="terms">
            <input name="terms" type="checkbox" required />
            I confirm I am acting for a real trading business and accept the <a href="/terms">trading terms</a>.
          </label>
        ) : null}
        <button type="submit">{mode === "signin" ? "Sign in" : "Create account"}</button>
        <strong>{state}</strong>
      </form>
      <p className="authswitch">
        {mode === "signin" ? "No account yet?" : "Already registered?"}
        {" "}
        <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setState(""); }}>
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </main>
  );
}
