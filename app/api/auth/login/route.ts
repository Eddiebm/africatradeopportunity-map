import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { verifyPassword } from "../../../../lib/auth/password";
import { clientIp, consumeRateLimit } from "../../../../lib/auth/rate-limit";
import { createSession, sessionCookieHeader } from "../../../../lib/auth/session";
import { logSecurityEvent } from "../../../../lib/auth/security-events";

const INVALID_CREDENTIALS = { error: "Incorrect email or password." };

export async function POST(request: Request) {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "";
  if (!(await consumeRateLimit(`login:${ip}`, 20, 900))) {
    return Response.json({ error: "Too many sign-in attempts. Try again in a few minutes." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return Response.json(INVALID_CREDENTIALS, { status: 401 });

  // Per-account bucket too, so a distributed attempt against one account
  // from many IPs still gets throttled.
  if (!(await consumeRateLimit(`login-account:${email}`, 10, 900))) {
    return Response.json({ error: "Too many sign-in attempts on this account. Try again later." }, { status: 429 });
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // Deliberately the same generic failure detail regardless of which
    // check failed (unknown email vs. wrong password) — the response to
    // the client already doesn't distinguish these; the audit log
    // shouldn't either, so this row can't be used to enumerate accounts
    // even by someone who can read the log.
    await logSecurityEvent("login_failed", { email, ip, userAgent, details: "unknown email or wrong password" });
    return Response.json(INVALID_CREDENTIALS, { status: 401 });
  }
  if (user.status !== "active") {
    await logSecurityEvent("login_failed", { email, ip, userAgent, details: "account not active" });
    return Response.json({ error: "This account is suspended. Contact support." }, { status: 403 });
  }

  const { cookieValue } = await createSession(user.id, { ip, userAgent });
  await logSecurityEvent("login_success", { email, ip, userAgent });
  const secure = new URL(request.url).protocol === "https:";

  return Response.json(
    {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: Boolean(user.emailVerifiedAt),
        platformRole: user.platformRole,
      },
    },
    { headers: { "Set-Cookie": sessionCookieHeader(cookieValue, secure) } },
  );
}
