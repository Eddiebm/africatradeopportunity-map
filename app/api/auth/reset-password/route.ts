import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { passwordResetTokens, users } from "../../../../db/schema";
import { hashPassword, passwordPolicyError } from "../../../../lib/auth/password";
import { clientIp, consumeRateLimit } from "../../../../lib/auth/rate-limit";
import { revokeAllSessionsForUser } from "../../../../lib/auth/session";
import { hashToken, isExpired } from "../../../../lib/auth/tokens";
import { logSecurityEvent } from "../../../../lib/auth/security-events";

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!(await consumeRateLimit(`pwreset-confirm:${ip}`, 15, 3600))) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const rawToken = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!rawToken) return Response.json({ error: "Reset link is invalid." }, { status: 400 });
  const policyError = passwordPolicyError(password);
  if (policyError) return Response.json({ error: policyError }, { status: 400 });

  const db = getDb();
  const tokenHash = await hashToken(rawToken);
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.consumedAt)))
    .limit(1);
  if (!record || isExpired(record.expiresAt)) {
    return Response.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const [updatedUser] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, record.userId))
    .returning({ email: users.email });
  await db.update(passwordResetTokens).set({ consumedAt: new Date().toISOString() }).where(eq(passwordResetTokens.id, record.id));
  // Force re-authentication on every device — a leaked-then-reset password
  // means old sessions should not still be trusted.
  await revokeAllSessionsForUser(record.userId);
  await logSecurityEvent("password_reset_completed", { email: updatedUser?.email, ip, userAgent: request.headers.get("user-agent") ?? "" });

  return Response.json({ ok: true });
}
