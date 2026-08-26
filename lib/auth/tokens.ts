// Random tokens for email verification / password reset links. The raw
// token is only ever sent to the user's email address — the database only
// ever stores its SHA-256 hash, so a leaked database (backup, replica,
// logging mistake) doesn't hand out working reset links.

const RAW_TOKEN_BYTES = 32; // 256 bits

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateRawToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(RAW_TOKEN_BYTES)));
}

export async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  return toHex(new Uint8Array(digest));
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}
