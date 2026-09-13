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
    };
  }
}

export type TurnstileFieldHandle = { reset: () => void };

export const TurnstileField = forwardRef<
  TurnstileFieldHandle,
  { action: TurnstileAction; onToken?: (token: string) => void }
>(function TurnstileField({ action, onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const renderWidget = useCallback(() => {
    if (!box.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(box.current, {
      sitekey: SITEKEY,
      action,
      callback: (token: string) => onTokenRef.current?.(token),
      "expired-callback": () => onTokenRef.current?.(""),
      "error-callback": () => onTokenRef.current?.(""),
    });
  }, [action]);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current?.("");
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
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
      <div ref={box} className="cf-turnstile" data-action={action} />
    </>
  );
});

TurnstileField.displayName = "TurnstileField";
