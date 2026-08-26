// Lightweight, D1-backed, fixed-window rate limiting for sensitive
// unauthenticated endpoints (login, register, password reset request).
//
// This is a defense-in-depth backstop, not the primary control — it is
// per-request-latency D1 reads/writes, and (being an app-layer counter
// without a unique constraint on the window key) tolerates a small race
// under concurrent bursts rather than guaranteeing an exact count.
// Production deployments must also configure Cloudflare's edge Rate
// Limiting / WAF rules (dashboard or Terraform) for the same endpoints —
// nothing in application code can reach the edge from here, and the edge
// rule is what actually stops a large-scale flood before it reaches the
// Worker at all.
import { getDb } from "../../db";
import { rateLimitAttempts } from "../../db/schema";
import { and, eq } from "drizzle-orm";

function windowStartIso(windowSeconds: number): string {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  return new Date(bucket * 1000).toISOString();
}

/** Returns true if the caller is within the limit (and records the
 * attempt); false if the limit has been exceeded for the current window. */
export async function consumeRateLimit(bucketKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  const db = getDb();
  const windowStart = windowStartIso(windowSeconds);
  const [existing] = await db
    .select()
    .from(rateLimitAttempts)
    .where(and(eq(rateLimitAttempts.bucketKey, bucketKey), eq(rateLimitAttempts.windowStart, windowStart)))
    .limit(1);

  if (!existing) {
    await db.insert(rateLimitAttempts).values({ bucketKey, windowStart, count: 1 });
    return limit >= 1;
  }
  if (existing.count >= limit) return false;
  await db
    .update(rateLimitAttempts)
    .set({ count: existing.count + 1 })
    .where(eq(rateLimitAttempts.id, existing.id));
  return true;
}

/** Best-effort client identifier for rate-limit bucketing. Cloudflare sets
 * CF-Connecting-IP at the edge; it cannot be spoofed by the client past
 * Cloudflare's own proxy. Falls back to a constant if absent (local dev). */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
}
