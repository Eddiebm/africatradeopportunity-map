import { clearSessionCookieHeader, resolveSession, revokeSessionByCookie, SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { clientIp } from "../../../../lib/auth/rate-limit";
import { logSecurityEvent } from "../../../../lib/auth/security-events";

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
  const cookieValue = parseCookie(request.headers.get("cookie"));
  // Resolve BEFORE revoking — once the session is gone, there's no way to
  // know whose logout this was for the audit log.
  const user = await resolveSession(cookieValue);
  await revokeSessionByCookie(cookieValue);
  if (user) {
    await logSecurityEvent("logout", { email: user.email, ip: clientIp(request), userAgent: request.headers.get("user-agent") ?? "" });
  }
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader(secure) } });
}
