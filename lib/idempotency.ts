// docs/AUDIT.md §5 item 8: "No idempotency keys on deal creation, dispute
// creation, or match interest — a retried POST creates a duplicate
// deal/dispute record (each with its own generated reference)."
//
// Match interest (app/api/marketplace/route.ts POST) turned out to already
// be safe: it derives a deterministic id from the two listing ids
// (`M-${demandId}-${supplyId}`) and does a select-then-insert-or-update, so
// a retried POST updates the same match row instead of creating a new one
// — no separate fix needed there. Deal creation and dispute creation had
// no such natural key (each generates a fresh crypto.randomUUID()-based
// reference on every insert), so this module covers those.
//
// The client sends an `Idempotency-Key` header once per logical user
// action (e.g. one value for one "submit" button click, reused if that
// same click's request is retried — a double-click, a network timeout the
// client retries, etc.). The key is scoped per-user + per-endpoint in the
// database (see db/schema.ts's idempotencyKeys unique index), so it can
// never let one user's retry collide with another user's action, or one
// endpoint's key collide with another endpoint's.
//
// The header is optional — a caller that doesn't send one just gets the
// pre-existing, non-idempotent behavior (this is additive, not a breaking
// API change for any existing client).
//
// CONCURRENCY: a naive "select for an existing row, insert if none" check
// has a real race — two requests carrying the same key can both see no
// row yet and both run the mutation before either finishes writing its
// result. This module closes that race with a claim/poll protocol:
//   1. A request claims the key by INSERTing a 'pending' row. The unique
//      index (user, endpoint, key) means only one concurrent INSERT can
//      win for the same action — the DB itself is the arbiter, not
//      anything in this process.
//   2. The request that won the claim runs the handler, then UPDATEs its
//      row to 'completed' with the response (or DELETEs the row on a
//      non-2xx/thrown result, so a genuinely failed attempt can actually
//      be retried rather than being permanently stuck).
//   3. A request that lost the claim polls the row briefly. If it flips
//      to 'completed', that response is replayed. If the row disappears
//      (the winner's attempt failed and released it), this request tries
//      to claim it itself. If neither happens before the poll deadline,
//      the winner is presumed still genuinely in flight and this request
//      returns 409 — safe, since the alternative is a duplicate mutation.
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { idempotencyKeys } from "../db/schema";
import type { SessionUser } from "./auth/current-user";

const MAX_KEY_LENGTH = 255;
const POLL_INTERVAL_MS = 100;
const MAX_WAIT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyFilter(userId: number, endpoint: string, key: string) {
  return and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.endpoint, endpoint), eq(idempotencyKeys.key, key));
}

async function runAndRecord(
  request: Request,
  user: SessionUser,
  endpoint: string,
  key: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const db = getDb();
  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    // The mutation itself threw — release the claim rather than leaving a
    // dead 'pending' row that would block every future retry forever.
    await db.delete(idempotencyKeys).where(keyFilter(user.id, endpoint, key)).catch(() => {});
    throw error;
  }

  if (response.status >= 200 && response.status < 300) {
    const body = await response.clone().text();
    await db
      .update(idempotencyKeys)
      .set({ status: "completed", responseStatus: response.status, responseBody: body, completedAt: new Date().toISOString() })
      .where(keyFilter(user.id, endpoint, key))
      .catch(() => {});
  } else {
    // Don't cache a failure — release the claim so a genuine retry (e.g.
    // after fixing a validation error, or a transient 500) can actually
    // run the mutation again instead of being replayed a stale failure.
    await db.delete(idempotencyKeys).where(keyFilter(user.id, endpoint, key)).catch(() => {});
  }
  return response;
}

export async function withIdempotency(
  request: Request,
  user: SessionUser,
  endpoint: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return handler();

  const db = getDb();

  let claimed = false;
  try {
    await db.insert(idempotencyKeys).values({ userId: user.id, endpoint, key, status: "pending" });
    claimed = true;
  } catch {
    // Unique-index violation: another request already holds this key
    // (completed, or still genuinely in flight).
  }

  if (claimed) return runAndRecord(request, user, endpoint, key, handler);

  // Lost the claim — poll briefly for the winner to finish.
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(idempotencyKeys).where(keyFilter(user.id, endpoint, key)).limit(1);
    if (row?.status === "completed" && row.responseStatus != null && row.responseBody != null) {
      return new Response(row.responseBody, {
        status: row.responseStatus,
        headers: { "content-type": "application/json", "idempotency-replayed": "true" },
      });
    }
    if (!row) break; // the winner released the claim (its attempt failed) — try to claim it ourselves, once
    await sleep(POLL_INTERVAL_MS);
  }

  // Either the row disappeared (winner failed) or we genuinely timed out
  // waiting. Try to claim the key ourselves, once — this is what lets a
  // retry succeed after a prior holder's attempt failed, without an
  // unbounded retry loop.
  try {
    await db.insert(idempotencyKeys).values({ userId: user.id, endpoint, key, status: "pending" });
  } catch {
    // Still contended — either the original holder is still genuinely
    // slow, or a third concurrent request won this second race. Either
    // way, running the mutation now would risk a duplicate; tell the
    // client the identical request is already being processed.
    return Response.json(
      { error: "An identical request is already being processed. Please wait a moment before retrying." },
      { status: 409 },
    );
  }
  return runAndRecord(request, user, endpoint, key, handler);
}
