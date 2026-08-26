// Client-safe auth path helpers — no "next/headers" / "next/navigation"
// import, so "use client" components can build a login redirect without
// pulling server-only code into the browser bundle. Server code should
// still prefer current-user.ts's requireUser()/requirePlatformRole(),
// which redirect() directly; this module exists for the places that need
// just the URL string (client components handling a 401 themselves).
export const LOGIN_PATH = "/login";

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function loginPath(returnTo = "/"): string {
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}
