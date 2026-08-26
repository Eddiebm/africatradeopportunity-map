// Replacement for the old app/chatgpt-auth.ts. Every "who is this?" check in
// the app must go through one of these functions — never trust an email,
// user id, or role supplied by the client (a request body field, a query
// param, a hidden form value). See docs/AUTH.md for the full contract.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PlatformRole } from "../../db/schema";
import { loginPath } from "./paths";
import { resolveSession, SESSION_COOKIE_NAME, type SessionUser } from "./session";

export { LOGIN_PATH, loginPath } from "./paths";
export type { SessionUser };

/** Read the current user in a Server Component / layout / page (not a
 * Route Handler — use getCurrentUserFromRequest there instead). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE_NAME)?.value ?? null);
}

/** Server Component guard: redirects anonymous visitors to /login. */
export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

/** Server Component guard: redirects non-admin visitors to /login (not a
 * generic dashboard — an unauthorized visitor should not learn that an
 * admin surface exists at a different URL than the one they hit). */
export async function requirePlatformRole(returnTo: string, roles: PlatformRole[]): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  if (!user.platformRole || !roles.includes(user.platformRole)) redirect(loginPath(returnTo));
  return user;
}

// --- Route Handler variants -------------------------------------------------
// Route Handlers receive the Request directly; reading the Cookie header off
// it is more robust across the App-Router/vinext boundary than relying on
// next/headers' cookies() write support inside handlers.

function parseCookieHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export async function getCurrentUserFromRequest(request: Request): Promise<SessionUser | null> {
  const cookieValue = parseCookieHeader(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  return resolveSession(cookieValue);
}

const UNAUTHORIZED = () => Response.json({ error: "Sign in required." }, { status: 401 });
const FORBIDDEN = (message = "You do not have access to this action.") => Response.json({ error: message }, { status: 403 });

/** Route Handler guard. Returns the user, or a ready-to-return 401 Response
 * — call sites do `const auth = await requireUserOrResponse(req); if (auth
 * instanceof Response) return auth; const user = auth;` */
export async function requireUserOrResponse(request: Request): Promise<SessionUser | Response> {
  const user = await getCurrentUserFromRequest(request);
  return user ?? UNAUTHORIZED();
}

/** Route Handler guard requiring a specific platform role (administrator,
 * verification_analyst). Returns 401 if signed out, 403 if signed in but
 * unauthorized — the distinction matters for the client's error handling. */
export async function requirePlatformRoleOrResponse(request: Request, roles: PlatformRole[]): Promise<SessionUser | Response> {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return UNAUTHORIZED();
  if (!user.platformRole || !roles.includes(user.platformRole)) return FORBIDDEN("Administrator access required.");
  return user;
}
