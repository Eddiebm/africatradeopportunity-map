import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getOrCreateOrganization } from "../../../../lib/org";
import { hashPassword } from "../../../../lib/crypto";
import { createSessionCookie, isAdminEmail, normalizeEmail } from "../../../../lib/session";
import { users } from "../../../../db/schema";

export async function POST(req: Request) {
  const body = await req.json() as Record<string, string>;
  const email = normalizeEmail(body.email || "");
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();
  const country = String(body.country || "").trim();
  if (!email.includes("@") || password.length < 8 || displayName.length < 2 || !country) {
    return Response.json({ error: "Use a real email, your name, country, and a password of at least 8 characters." }, { status: 400 });
  }
  if (body.terms !== "accepted") {
    return Response.json({ error: "Accept the trading terms before creating an account." }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return Response.json({ error: "An account already exists for that email. Sign in instead." }, { status: 409 });

  const [user] = await db.insert(users).values({
    email,
    passwordHash: await hashPassword(password),
    displayName,
    country,
    role: isAdminEmail(email) ? "admin" : "trader",
  }).returning();

  await getOrCreateOrganization({ email, displayName, fullName: displayName }, country);
  const cookie = await createSessionCookie(user.id, req.url);
  return new Response(JSON.stringify({ user: { email, displayName, role: user.role } }), {
    status: 201,
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
