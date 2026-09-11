import { getCurrentUserFromRequest } from "../../../../lib/auth/current-user";

/** Lightweight "who am I" check for client components (nav bars, etc.) that
 * need to render sign-in state without a full page load. Never includes
 * anything beyond what's safe to show the signed-in user themselves. */
export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return Response.json({ user: null });
  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: Boolean(user.emailVerifiedAt),
      platformRole: user.platformRole,
    },
  });
}
