import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { verifyPassword } from "../../../../lib/crypto";
import { createSessionCookie, normalizeEmail } from "../../../../lib/session";

export async function POST(req: Request) {
  const body = await req.json() as Record<string, string>;
  const email = normalizeEmail(body.email || "");
  const password = String(body.password || "");
  if (!email || !password) return Response.json({ error: "Email and password are required." }, { status: 400 });

  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const cookie = await createSessionCookie(user.id, req.url);
  return new Response(JSON.stringify({ user: { email: user.email, displayName: user.displayName, role: user.role } }), {
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
