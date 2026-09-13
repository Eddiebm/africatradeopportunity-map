"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import Script from "next/script";
import type { TurnstileAction } from "../../lib/turnstile-actions";

const SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAEyli_jivDIa7jYt";

const readyWaiters = new Set<() => void>();

function whenTurnstileReady(cb: () => void) {
  if (typeof window !== "undefined" && window.turnstile) {
    cb();
    return;
  }
  readyWaiters.add(cb);
}

function notifyTurnstileReady() {
  for (const waiter of readyWaiters) waiter();
  readyWaiters.clear();
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
      getResponse: (id: string) => string | undefined;
    };
  }
}

export type TurnstileFieldHandle = { reset: () => void; getToken: () => string };

export function tokenFromTurnstile(
  field: TurnstileFieldHandle | null,
  form: FormData,
): string {
  return field?.getToken() || String(form.get("cf-turnstile-response") ?? "").trim();
}

export const TurnstileField = forwardRef<
  TurnstileFieldHandle,
  { action: TurnstileAction; onToken?: (token: string) => void }
>(function TurnstileField({ action, onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const lastToken = useRef("");
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const renderWidget = useCallback(() => {
    if (!box.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(box.current, {
      sitekey: SITEKEY,
      action,
      "response-field": true,
      "response-field-name": "cf-turnstile-response",
      callback: (token: string) => {
        lastToken.current = token;
        onTokenRef.current?.(token);
      },
      "expired-callback": () => {
        lastToken.current = "";
        onTokenRef.current?.("");
      },
      "error-callback": () => {
        lastToken.current = "";
        onTokenRef.current?.("");
      },
    });
  }, [action]);

  useImperativeHandle(ref, () => ({
    reset() {
      lastToken.current = "";
      onTokenRef.current?.("");
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
    getToken() {
      const live =
        widgetId.current && window.turnstile ? window.turnstile.getResponse(widgetId.current) : "";
      return (typeof live === "string" && live) || lastToken.current;
    },
  }));

  useEffect(() => {
    whenTurnstileReady(renderWidget);
    return () => {
      readyWaiters.delete(renderWidget);
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [action, renderWidget]);

  return (
    <>
      <Script
        id="cf-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={notifyTurnstileReady}
      />
      {/* Explicit render: do not use class cf-turnstile (that triggers implicit scan). */}
      <div ref={box} data-action={action} />
    </>
  );
});

TurnstileField.displayName = "TurnstileField";
