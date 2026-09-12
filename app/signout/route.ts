import { clearSessionCookie, destroyCurrentSession } from "../../lib/session";

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(req: Request) {
  await destroyCurrentSession();
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("return_to"));
  return new Response(null, {
    status: 302,
    headers: { Location: returnTo, "set-cookie": clearSessionCookie() },
  });
}

export async function POST() {
  await destroyCurrentSession();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() },
  });
}
