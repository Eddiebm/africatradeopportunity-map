"use client";

import { useState } from "react";

export function ResendVerificationButton() {
  const [state, setState] = useState("");

  async function send() {
    setState("Sending…");
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = (await res.json()) as { error?: string; email?: { delivered?: boolean } };
      if (!res.ok) {
        setState(data.error || "Could not send.");
        return;
      }
      setState(data.email?.delivered ? "Sent. Check your inbox." : "Not sent — outbound mail is still not delivering.");
    } catch {
      setState("Could not send.");
    }
  }

  return (
    <p>
      <button type="button" onClick={send}>
        Send verification link again
      </button>
      {state ? <span> {state}</span> : null}
    </p>
  );
}
