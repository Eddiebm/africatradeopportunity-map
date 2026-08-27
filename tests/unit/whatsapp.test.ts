// Priority 10 (docs/production-readiness.md): WhatsApp-ready acquisition.
// No real WhatsApp Business API credentials exist in this environment —
// these tests prove the REAL, working code paths (consent/opt-out,
// message audit log, secure expiring links, the inbound webhook, the
// milestone-notification trigger) against the real ConsoleWhatsAppProvider
// and a real D1-backed test database, not that a real provider was
// actually reached (it wasn't — that's the whole point of the adapter).
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  adminAuditEvents, deals, dealCosts, dealEvents, milestones, marketRequests, sessions, secureLinks, users,
  whatsappContacts, whatsappMessages,
} from "../../db/schema";
import {
  getOptedInPhoneForEmail, getWhatsAppContact, isOptedOut, looksLikeOptOut,
  recordWhatsAppConsent, recordWhatsAppOptOut, sendWhatsAppMessage,
} from "../../lib/whatsapp";
import { createSecureLink, resolveSecureLink } from "../../lib/secure-links";
import { notifyMilestoneEventByWhatsApp } from "../../lib/whatsapp-notify";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { POST as linkPost, GET as linkGet } from "../../app/api/whatsapp/link/route";
import { POST as webhookPost } from "../../app/api/webhooks/whatsapp/route";
import { PATCH as deskPatch } from "../../app/api/admin/desk/route";
import LinkPage from "../../app/link/[token]/page";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}
async function makeDeal(ownerEmail: string) {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" }).returning();
  await db.insert(dealCosts).values({ dealId: row.id, supplierCost: 100 });
  return row;
}
function reqWithCookie(cookieValue: string | undefined, url: string, body?: unknown): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body ? "POST" : "GET", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

async function cleanAll() {
  const db = getDb();
  await db.delete(secureLinks);
  await db.delete(whatsappMessages);
  await db.delete(whatsappContacts);
  await db.delete(adminAuditEvents);
  await db.delete(dealEvents);
  await db.delete(milestones);
  await db.delete(marketRequests);
  await db.delete(dealCosts);
  await db.delete(deals);
  await db.delete(sessions);
  await db.delete(users);
}

describe("lib/whatsapp — consent, opt-out, sending", () => {
  beforeEach(cleanAll);

  it("recordWhatsAppConsent creates a new contact with a real consent timestamp", async () => {
    const contact = await recordWhatsAppConsent("+233555000111", "trader@example.com");
    expect(contact.consentAt).not.toBeNull();
    expect(contact.optOutAt).toBeNull();
    expect(contact.linkedEmail).toBe("trader@example.com");
  });

  it("recordWhatsAppOptOut on a number with NO prior contact still creates a blocking record (pre-emptive opt-out)", async () => {
    await recordWhatsAppOptOut("+233555000222");
    expect(await isOptedOut("+233555000222")).toBe(true);
  });

  it("re-consenting after an opt-out clears optOutAt", async () => {
    await recordWhatsAppOptOut("+233555000333");
    expect(await isOptedOut("+233555000333")).toBe(true);
    await recordWhatsAppConsent("+233555000333");
    expect(await isOptedOut("+233555000333")).toBe(false);
  });

  it("sendWhatsAppMessage REFUSES to send to a number with no consent on file — logged as failed, not attempted", async () => {
    const result = await sendWhatsAppMessage({ to: "+233555000444", body: "hello" });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no_consent");
    const [row] = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.phoneNumber, "+233555000444"));
    expect(row.deliveryStatus).toBe("failed");
  });

  it("sendWhatsAppMessage REFUSES to send to an opted-out number, even with prior consent", async () => {
    await recordWhatsAppConsent("+233555000555");
    await recordWhatsAppOptOut("+233555000555");
    const result = await sendWhatsAppMessage({ to: "+233555000555", body: "hello" });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("opted_out");
  });

  it("sendWhatsAppMessage to a consented number is honestly logged as NOT delivered (no real provider connected) and includes a real opt-out link", async () => {
    await recordWhatsAppConsent("+233555000666");
    const result = await sendWhatsAppMessage({ to: "+233555000666", body: "Your deal update" });
    expect(result.sent).toBe(false); // never fabricated as delivered
    const [row] = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.phoneNumber, "+233555000666"));
    expect(row.deliveryStatus).toBe("not_configured"); // honest, not "sent"
    expect(row.body).toMatch(/Reply STOP to opt out, or: https:\/\/tradesafe\.africa\/link\//);
    const [link] = await getDb().select().from(secureLinks).where(eq(secureLinks.purpose, "whatsapp_opt_out"));
    expect(link).toBeTruthy();
  });

  it("getOptedInPhoneForEmail finds a real linked, opted-in number and ignores an opted-out one", async () => {
    await recordWhatsAppConsent("+233555000777", "buyer@example.com");
    expect(await getOptedInPhoneForEmail("buyer@example.com")).toBe("+233555000777");
    await recordWhatsAppOptOut("+233555000777");
    expect(await getOptedInPhoneForEmail("buyer@example.com")).toBeNull();
  });

  it("getOptedInPhoneForEmail returns null for an account with no linked number — never fabricated", async () => {
    expect(await getOptedInPhoneForEmail("nobody@example.com")).toBeNull();
  });

  it("looksLikeOptOut matches real STOP-style keywords and does NOT false-positive on ordinary text containing the word", async () => {
    expect(looksLikeOptOut("STOP")).toBe(true);
    expect(looksLikeOptOut("  stop  ")).toBe(true);
    expect(looksLikeOptOut("unsubscribe")).toBe(true);
    expect(looksLikeOptOut("opt out")).toBe(true);
    expect(looksLikeOptOut("please stop by the office tomorrow")).toBe(false); // "stop" mid-sentence is not an opt-out
    expect(looksLikeOptOut("I want to buy 20 tonnes of rice")).toBe(false);
  });
});

describe("lib/secure-links — createSecureLink / resolveSecureLink", () => {
  beforeEach(cleanAll);

  it("a freshly created link resolves successfully and carries the real entity it was created for", async () => {
    const { rawToken } = await createSecureLink({ purpose: "milestone_notification", entityType: "deal", entityId: 42 });
    const resolved = await resolveSecureLink(rawToken);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.entityType).toBe("deal");
      expect(resolved.entityId).toBe(42);
    }
  });

  it("an expired link is rejected", async () => {
    const { rawToken } = await createSecureLink({ purpose: "milestone_notification", entityType: "deal", entityId: 1, ttlMinutes: -1 });
    const resolved = await resolveSecureLink(rawToken);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("expired");
  });

  it("a random/nonexistent token is rejected as not_found, not a crash", async () => {
    const resolved = await resolveSecureLink("0".repeat(64));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("not_found");
  });

  it("resolving the SAME link twice does not invalidate it — openCount increments, firstOpenedAt stays fixed", async () => {
    const { rawToken } = await createSecureLink({ purpose: "milestone_notification", entityType: "deal", entityId: 7 });
    const first = await resolveSecureLink(rawToken);
    expect(first.ok).toBe(true);
    const [row1] = await getDb().select().from(secureLinks);
    const second = await resolveSecureLink(rawToken);
    expect(second.ok).toBe(true); // still valid — a real recipient clicking twice must not see "expired"
    const [row2] = await getDb().select().from(secureLinks);
    expect(row2.openCount).toBe(2);
    expect(row2.firstOpenedAt).toBe(row1.firstOpenedAt);
  });

  it("the RAW token is never recoverable from the stored row — only its hash is persisted", async () => {
    const { rawToken } = await createSecureLink({ purpose: "x", entityType: "deal", entityId: 1 });
    const [row] = await getDb().select().from(secureLinks);
    expect(row.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });
});

describe("app/link/[token]/page.tsx", () => {
  beforeEach(cleanAll);

  it("a valid deal-purpose link redirects to the REAL, auth-gated /deal/:id page — not a bypass, a handoff", async () => {
    const { rawToken } = await createSecureLink({ purpose: "milestone_notification", entityType: "deal", entityId: 99 });
    await expect(LinkPage({ params: Promise.resolve({ token: rawToken }) })).rejects.toThrow("NEXT_REDIRECT:/deal/99");
  });

  it("an expired/invalid link renders an honest message instead of redirecting anywhere", async () => {
    const result = await LinkPage({ params: Promise.resolve({ token: "not-a-real-token" }) });
    const text = JSON.stringify(result);
    expect(text).toMatch(/not valid/i);
  });

  it("a whatsapp_opt_out link actually opts out the real phone number, without needing to redirect", async () => {
    await recordWhatsAppConsent("+233555000888");
    const contact = await getWhatsAppContact("+233555000888");
    const { rawToken } = await createSecureLink({ purpose: "whatsapp_opt_out", entityType: "whatsapp_contact", entityId: contact!.id, createdForPhone: "+233555000888" });
    await LinkPage({ params: Promise.resolve({ token: rawToken }) });
    expect(await isOptedOut("+233555000888")).toBe(true);
  });
});

describe("app/api/whatsapp/link route", () => {
  beforeEach(cleanAll);

  it("requires authentication", async () => {
    const res = await linkPost(reqWithCookie(undefined, "http://localhost/api/whatsapp/link", { phoneNumber: "+233555000999" }));
    expect(res.status).toBe(401);
  });

  it("rejects a non-E.164 phone number", async () => {
    const userId = await makeUser("linkme@example.com");
    const { cookieValue } = await createSession(userId, {});
    const res = await linkPost(reqWithCookie(cookieValue, "http://localhost/api/whatsapp/link", { phoneNumber: "0555000999" }));
    expect(res.status).toBe(400);
  });

  it("a real E.164 number is linked and consent recorded, then visible via GET", async () => {
    const userId = await makeUser("linkme2@example.com");
    const { cookieValue } = await createSession(userId, {});
    const post = await linkPost(reqWithCookie(cookieValue, "http://localhost/api/whatsapp/link", { phoneNumber: "+233555001000" }));
    expect(post.status).toBe(200);
    const get = await linkGet(reqWithCookie(cookieValue, "http://localhost/api/whatsapp/link"));
    const body = (await get.json()) as { phoneNumber: string | null };
    expect(body.phoneNumber).toBe("+233555001000");
  });
});

describe("app/api/webhooks/whatsapp route (inbound)", () => {
  beforeEach(cleanAll);

  it("rejects a request missing sender or text", async () => {
    const res = await webhookPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "+233555001111" }) }));
    expect(res.status).toBe(400);
  });

  it("a STOP message opts the sender out and does NOT create a quote request", async () => {
    const res = await webhookPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "+233555001222", text: "STOP" }) }));
    expect(res.status).toBe(200);
    expect(await isOptedOut("+233555001222")).toBe(true);
    const requests = await getDb().select().from(marketRequests);
    expect(requests.some((r) => r.contact === "+233555001222")).toBe(false);
  });

  it("an ordinary inbound message logs the audit row, records real consent, AND creates a real quote_request", async () => {
    const res = await webhookPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "+233555001333", text: "I need 20 tonnes of maize delivered to Accra" }) }));
    expect(res.status).toBe(200);
    const [inbound] = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.phoneNumber, "+233555001333"));
    expect(inbound.direction).toBe("inbound");
    expect(inbound.body).toBe("I need 20 tonnes of maize delivered to Accra");
    const [request] = await getDb().select().from(marketRequests).where(eq(marketRequests.contact, "+233555001333"));
    expect(request.role).toBe("quote_request");
    expect(request.product).toBe("I need 20 tonnes of maize delivered to Accra"); // raw text, never guessed/parsed into fake structured fields
    expect(request.destination).toBe(""); // genuinely unknown from free text — never fabricated
    const contact = await getWhatsAppContact("+233555001333");
    expect(contact?.consentAt).not.toBeNull(); // inbound message = real WhatsApp-convention consent signal
  });

  it("processes without a configured WHATSAPP_WEBHOOK_SECRET — documented as 'not verified,' not silently faked as authentic", async () => {
    // No secret is configured in this test environment (matches
    // lib/turnstile.ts's own untested-when-configured limitation) — this
    // just proves the endpoint doesn't hard-fail with nothing configured.
    const res = await webhookPost(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "+233555001444", text: "hello" }) }));
    expect(res.status).toBe(200);
  });
});

describe("Priority 10 x Priority 7/8 integration: milestone verification triggers a real WhatsApp notification attempt", () => {
  beforeEach(cleanAll);

  it("verifying a milestone for a deal owner with NO opted-in number sends nothing, and does not break the milestone review", async () => {
    const adminId = await makeUser("wa-admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal("no-whatsapp-owner@example.com");
    const [m] = await getDb().insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x" }).returning();

    const res = await deskPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/desk", { entity: "milestone", id: m.id, status: "verified", reason: "evidence checked" }));
    expect(res.status).toBe(200); // the real, existing milestone-review behavior is unaffected
    const messages = await getDb().select().from(whatsappMessages);
    expect(messages.length).toBe(0); // nothing to send to — no fabricated attempt
  });

  it("verifying a milestone for a deal owner WITH a real opted-in number sends a real WhatsApp notification with a real secure link, never raw content", async () => {
    const adminId = await makeUser("wa-admin2@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal("has-whatsapp-owner@example.com");
    await recordWhatsAppConsent("+233555002000", "has-whatsapp-owner@example.com");
    const [m] = await getDb().insert(milestones).values({ dealId: deal.id, sequence: 2, name: "Verified loading", releaseCondition: "x" }).returning();

    const res = await deskPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/desk", { entity: "milestone", id: m.id, status: "verified", reason: "loading evidence confirmed" }));
    expect(res.status).toBe(200);

    const [outbound] = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.phoneNumber, "+233555002000"));
    expect(outbound.direction).toBe("outbound");
    expect(outbound.body).toContain(deal.reference);
    expect(outbound.body).toContain("Verified loading");
    expect(outbound.body).toMatch(/https:\/\/tradesafe\.africa\/link\//); // a link, never the milestone's actual evidence content
    const [link] = await getDb().select().from(secureLinks).where(eq(secureLinks.purpose, "milestone_notification"));
    expect(link.entityType).toBe("deal");
    expect(link.entityId).toBe(deal.id);
  });

  it("directly calling notifyMilestoneEventByWhatsApp for an unlinked email is a real no-op, not an error", async () => {
    const result = await notifyMilestoneEventByWhatsApp({ dealId: 1, dealReference: "DEAL-X", milestoneName: "Contract", summary: "evidence verified", ownerEmail: "unlinked@example.com" });
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toBe("no_opted_in_number");
  });
});
