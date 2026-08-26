import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { emailVerificationTokens, users } from "../../../../db/schema";
import { hashPassword, passwordPolicyError } from "../../../../lib/auth/password";
import { clientIp, consumeRateLimit } from "../../../../lib/auth/rate-limit";
import { createSession, sessionCookieHeader } from "../../../../lib/auth/session";
import { generateRawToken, hashToken, minutesFromNow } from "../../../../lib/auth/tokens";
import { getEmailProvider } from "../../../../lib/email";
import { turnstileEnforced, verifyTurnstile } from "../../../../lib/turnstile";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!(await consumeRateLimit(`register:${ip}`, 8, 3600))) {
    return Response.json({ error: "Too many registration attempts. Try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const turnstile = await verifyTurnstile(
    typeof body.turnstileToken === "string" ? body.turnstileToken : undefined,
    ip,
  );
  if (!turnstile.success && turnstileEnforced()) {
    return Response.json({ error: "Verification failed. Please try again." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.displayName ?? "").trim().slice(0, 120);
  const termsAccepted = body.termsAccepted === true;

  if (!EMAIL_PATTERN.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const policyError = passwordPolicyError(password);
  if (policyError) return Response.json({ error: policyError }, { status: 400 });
  if (!termsAccepted) {
    return Response.json({ error: "You must accept the Terms of Service and Privacy Policy." }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    // Deliberately vague — do not confirm which email addresses are registered.
    return Response.json({ error: "That email could not be registered. Try signing in instead." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, displayName, termsAcceptedAt: now })
    .returning();

  const rawToken = generateRawToken();
  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    tokenHash: await hashToken(rawToken),
    expiresAt: minutesFromNow(60 * 24),
  });
  const origin = new URL(request.url).origin;
  await getEmailProvider().send({
    to: email,
    subject: "Verify your TradeSafe Africa account",
    text: `Confirm your email to finish setting up your account:\n\n${origin}/verify-email?token=${rawToken}\n\nThis link expires in 24 hours. If you did not create this account, ignore this message.`,
  });

  const { cookieValue } = await createSession(user.id, {
    ip,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  const secure = new URL(request.url).protocol === "https:";

  return Response.json(
    {
      user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: false },
    },
    { status: 201, headers: { "Set-Cookie": sessionCookieHeader(cookieValue, secure) } },
  );
}
