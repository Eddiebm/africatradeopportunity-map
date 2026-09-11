import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { passwordResetTokens, users } from "../../../../db/schema";
import { clientIp, consumeRateLimit } from "../../../../lib/auth/rate-limit";
import { generateRawToken, hashToken, minutesFromNow } from "../../../../lib/auth/tokens";
import { getEmailProvider } from "../../../../lib/email";
import { logSecurityEvent } from "../../../../lib/auth/security-events";

// Always returns the same generic message, whether or not the address is
// registered — never let this endpoint confirm which emails have accounts.
const GENERIC_RESPONSE = { message: "If an account exists for that email, a reset link has been sent." };

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!(await consumeRateLimit(`pwreset:${ip}`, 6, 3600))) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email) return Response.json({ error: "Enter your email address." }, { status: 400 });

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && user.status === "active") {
    const rawToken = generateRawToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: await hashToken(rawToken),
      expiresAt: minutesFromNow(30),
    });
    const origin = new URL(request.url).origin;
    await getEmailProvider().send({
      to: email,
      subject: "Reset your TradeSafe Africa password",
      text: `Reset your password:\n\n${origin}/reset-password?token=${rawToken}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this message.`,
    });
  }
  // Logged for BOTH cases (account exists or not) with the same shape —
  // the log itself never distinguishes them either, matching the generic
  // response's own anti-enumeration guarantee.
  await logSecurityEvent("password_reset_requested", { email, ip, userAgent: request.headers.get("user-agent") ?? "" });

  return Response.json(GENERIC_RESPONSE);
}
