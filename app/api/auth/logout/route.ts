import { clearSessionCookieHeader, revokeSessionByCookie, SESSION_COOKIE_NAME } from "../../../../lib/auth/session";

function parseCookie(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export async function POST(request: Request) {
  await revokeSessionByCookie(parseCookie(request.headers.get("cookie")));
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader(secure) } });
}
