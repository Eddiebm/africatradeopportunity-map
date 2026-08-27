// Priority 10 (docs/production-readiness.md): "Never send identity docs,
// bank details, confidential evidence or sensitive files through WhatsApp
// — send authenticated expiring links to TradeSafe instead."
//
// A secure link does NOT bypass this platform's real authentication (see
// app/link/[token]/page.tsx) — resolving one just proves "a specific
// notification was actually generated for this phone number, recently,"
// then hands the visitor to the SAME auth-gated destination page every
// other path already uses (Priority 1's requireDealAccess and friends).
// This is deliberate: building a second, weaker auth path defeats the
// entire point of "send a link instead of the sensitive content itself."
import { getDb } from "../db";
import { secureLinks } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateRawToken, hashToken, isExpired, minutesFromNow } from "./auth/tokens";

const DEFAULT_TTL_MINUTES = 60 * 24 * 7; // 7 days — long enough for a WhatsApp recipient to act without rushing, short enough that a stale, unused link isn't a permanent standing credential.

export async function createSecureLink(input: {
  purpose: string;
  entityType: string;
  entityId: number;
  createdForPhone?: string;
  ttlMinutes?: number;
}): Promise<{ rawToken: string; expiresAt: string }> {
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = minutesFromNow(input.ttlMinutes ?? DEFAULT_TTL_MINUTES);
  await getDb().insert(secureLinks).values({
    tokenHash,
    purpose: input.purpose,
    entityType: input.entityType,
    entityId: input.entityId,
    createdForPhone: input.createdForPhone || "",
    expiresAt,
  });
  return { rawToken, expiresAt };
}

export type ResolvedSecureLink =
  | { ok: true; purpose: string; entityType: string; entityId: number }
  | { ok: false; reason: "not_found" | "expired" };

export async function resolveSecureLink(rawToken: string): Promise<ResolvedSecureLink> {
  const db = getDb();
  const tokenHash = await hashToken(rawToken);
  const [row] = await db.select().from(secureLinks).where(eq(secureLinks.tokenHash, tokenHash)).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (isExpired(row.expiresAt)) return { ok: false, reason: "expired" };

  // Informational only — does not gate access (see this file's header).
  const now = new Date().toISOString();
  await db
    .update(secureLinks)
    .set({
      firstOpenedAt: row.firstOpenedAt ?? now,
      openCount: row.openCount + 1,
    })
    .where(eq(secureLinks.id, row.id));

  return { ok: true, purpose: row.purpose, entityType: row.entityType, entityId: row.entityId };
}
