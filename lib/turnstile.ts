import { env } from "cloudflare:workers";
import type { TurnstileAction } from "./turnstile-actions";

export type { TurnstileAction } from "./turnstile-actions";

export type TurnstileResult = { success: boolean; reason: string };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function secretKey(): string {
  return (env.TURNSTILE_SECRET || env.TURNSTILE_SECRET_KEY || "").trim();
}

function expectedHostnames(): Set<string> {
  return new Set(
    String(env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );
}

function tokenLooksUsable(token: string | undefined): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= 2048;
}

/**
 * Canonical Siteverify: browser token → this Worker → Cloudflare.
 * Requires success, the expected widget action, and an allowlisted hostname.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
  expectedAction: TurnstileAction,
): Promise<TurnstileResult> {
  switch (expectedAction) {
    case "signup":
    case "login":
    case "password-reset":
    case "listing":
    case "protect":
    case "quote":
      break;
    default: {
      const _exhaustive: never = expectedAction;
      return { success: false, reason: `Unknown Turnstile action: ${String(_exhaustive)}` };
    }
  }

  const secret = secretKey();
  if (!secret) {
    return {
      success: false,
      reason: "Turnstile is not configured in this environment (no TURNSTILE_SECRET) — the token was not checked.",
    };
  }
  const hosts = expectedHostnames();
  if (!tokenLooksUsable(token) || hosts.size === 0) {
    return { success: false, reason: "Turnstile token or hostname allowlist is missing." };
  }

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp && remoteIp !== "unknown" ? { remoteip: remoteIp } : {}),
      }),
    });
    if (!res.ok) {
      return { success: false, reason: `Turnstile siteverify request failed (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    };
    if (data.success !== true || data.action !== expectedAction || !hosts.has(String(data.hostname ?? ""))) {
      const codes = data["error-codes"]?.join(", ") || "action-or-hostname mismatch";
      return { success: false, reason: `Turnstile siteverify rejected the token (${codes}).` };
    }
    return { success: true, reason: "Verified by Cloudflare Turnstile siteverify." };
  } catch (err) {
    return {
      success: false,
      reason: `Turnstile siteverify request errored: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function turnstileEnforced(): boolean {
  return Boolean(secretKey()) || process.env.NODE_ENV === "production";
}

export function turnstileTokenFromBody(body: object): string | undefined {
  const record = body as Record<string, unknown>;
  if (typeof record.turnstileToken === "string") return record.turnstileToken;
  if (typeof record["cf-turnstile-response"] === "string") return record["cf-turnstile-response"];
  return undefined;
}
