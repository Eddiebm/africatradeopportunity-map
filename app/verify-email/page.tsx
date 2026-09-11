import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { emailVerificationTokens, users } from "../../db/schema";
import { hashToken, isExpired } from "../../lib/auth/tokens";

export const dynamic = "force-dynamic";

async function verify(rawToken: string): Promise<{ ok: boolean; message: string }> {
  if (!rawToken) return { ok: false, message: "This verification link is missing its token." };
  const db = getDb();
  const tokenHash = await hashToken(rawToken);
  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.tokenHash, tokenHash), isNull(emailVerificationTokens.consumedAt)))
    .limit(1);
  if (!record || isExpired(record.expiresAt)) {
    return { ok: false, message: "This verification link is invalid or has expired. Request a new one from your account settings." };
  }
  await db.update(users).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(users.id, record.userId));
  await db.update(emailVerificationTokens).set({ consumedAt: new Date().toISOString() }).where(eq(emailVerificationTokens.id, record.id));
  return { ok: true, message: "Your email address is verified." };
}

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = await verify(token ?? "");
  return (
    <main className="portal">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Email verification</small>
          </span>
        </div>
        <nav>
          <a href="/dashboard">My deals</a>
          <a href="/">Atlas</a>
        </nav>
      </header>
      <section className="portalempty" style={{ margin: "48px 6vw" }}>
        <h1>{result.ok ? "Email verified" : "Verification failed"}</h1>
        <p>{result.message}</p>
        <a href={result.ok ? "/dashboard" : "/login"}>{result.ok ? "Go to my trade desk →" : "Return to sign in →"}</a>
      </section>
    </main>
  );
}
