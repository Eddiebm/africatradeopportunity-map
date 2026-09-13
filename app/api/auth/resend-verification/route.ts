import { getDb } from "../../../../db";
import { emailVerificationTokens } from "../../../../db/schema";
import { requireUserOrResponse } from "../../../../lib/auth/current-user";
import { clientIp, consumeRateLimit } from "../../../../lib/auth/rate-limit";
import { generateRawToken, hashToken, minutesFromNow } from "../../../../lib/auth/tokens";
import { getEmailProvider } from "../../../../lib/email";

export async function POST(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;

  if (user.emailVerifiedAt) {
    return Response.json({ email: { delivered: true, provider: "none" }, alreadyVerified: true });
  }

  const ip = clientIp(request);
  if (!(await consumeRateLimit(`verify-resend:${ip}`, 6, 3600))) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const rawToken = generateRawToken();
  await getDb().insert(emailVerificationTokens).values({
    userId: user.id,
    tokenHash: await hashToken(rawToken),
    expiresAt: minutesFromNow(60 * 24),
  });
  const origin = new URL(request.url).origin;
  const emailSend = await getEmailProvider().send({
    to: user.email,
    subject: "Verify your TradeSafe Africa account",
    text: `Confirm your email to finish setting up your account:\n\n${origin}/verify-email?token=${rawToken}\n\nThis link expires in 24 hours. If you did not create this account, ignore this message.`,
  });
  if (!emailSend.delivered) {
    console.error("[email] resend-verification not delivered", emailSend.provider, emailSend.detail);
  }
  return Response.json({ email: { delivered: emailSend.delivered, provider: emailSend.provider } });
}
