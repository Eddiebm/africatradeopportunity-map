// Password hashing using PBKDF2-HMAC-SHA256 via the Web Crypto API
// (available natively in the Workers runtime and in Node — no native
// bcrypt/argon2 addon, which would not run on Workers).
//
// Stored format: `pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>`
// Versioned so the iteration count (or algorithm) can be raised later
// without invalidating existing hashes — verifyPassword re-derives with
// whatever parameters are embedded in the stored hash, not the current
// default.

const ALGORITHM = "pbkdf2";
const DIGEST = "sha256";
const DEFAULT_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, DEFAULT_ITERATIONS);
  return `${ALGORITHM}$${DIGEST}$${DEFAULT_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== ALGORITHM || parts[1] !== DIGEST) return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = fromBase64(parts[3]);
  const expected = fromBase64(parts[4]);
  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison — do not short-circuit on first mismatch.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const MIN_PASSWORD_LENGTH = 10;

/** Minimal, honest password policy: length only. No composition rules —
 * those push users toward predictable patterns without adding real entropy.
 * Returns an error string, or null if the password is acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 256) {
    return "Password is too long.";
  }
  return null;
}
