// Priority 6 (docs/production-readiness.md): "Create a rules engine that
// recommends the required verification level." Pure decision support —
// this route writes nothing and blocks nothing; see
// lib/verification-levels.ts's recommendVerificationLevel for the AI
// boundary this respects (recommends, never finalizes a decision).
// Restricted to reviewer roles because the inputs (dispute counts,
// evidence quality judgment) are staff-facing, not because the output
// itself is sensitive.
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { recommendVerificationLevel } from "../../../../lib/verification-levels";

const PRODUCT_RISKS = ["low", "medium", "high"];
const PAYMENT_TERMS = ["advance", "letter_of_credit", "net_terms", "on_delivery"];
const EVIDENCE_QUALITIES = ["low", "medium", "high"];
const CORRIDOR_TIERS = ["intelligence", "operational", "verified"];

export async function POST(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, ["administrator", "verification_analyst"]);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const productRisk = String(body.productRisk ?? "low");
  const paymentTerms = String(body.paymentTerms ?? "on_delivery");
  const evidenceQuality = String(body.evidenceQuality ?? "medium");
  const corridorTier = String(body.corridorTier ?? "intelligence");
  if (!PRODUCT_RISKS.includes(productRisk)) return Response.json({ error: `productRisk must be one of: ${PRODUCT_RISKS.join(", ")}` }, { status: 400 });
  if (!PAYMENT_TERMS.includes(paymentTerms)) return Response.json({ error: `paymentTerms must be one of: ${PAYMENT_TERMS.join(", ")}` }, { status: 400 });
  if (!EVIDENCE_QUALITIES.includes(evidenceQuality)) return Response.json({ error: `evidenceQuality must be one of: ${EVIDENCE_QUALITIES.join(", ")}` }, { status: 400 });
  if (!CORRIDOR_TIERS.includes(corridorTier)) return Response.json({ error: `corridorTier must be one of: ${CORRIDOR_TIERS.join(", ")}` }, { status: 400 });

  const recommendation = recommendVerificationLevel({
    transactionValueUsd: Number(body.transactionValueUsd) || 0,
    corridorTier: corridorTier as "intelligence" | "operational" | "verified",
    productRisk: productRisk as "low" | "medium" | "high",
    isFirstTimeRelationship: body.isFirstTimeRelationship !== false,
    priorDisputeCount: Number(body.priorDisputeCount) || 0,
    paymentTerms: paymentTerms as "advance" | "letter_of_credit" | "net_terms" | "on_delivery",
    evidenceQuality: evidenceQuality as "low" | "medium" | "high",
  });

  return Response.json(recommendation);
}
