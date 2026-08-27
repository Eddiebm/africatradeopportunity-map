import { requireDealAccessOrResponse, canManageDeal } from "../../../../../lib/auth/deal-access";
import { getLandedCostBreakdown, recordLandedCostEntry } from "../../../../../lib/landed-cost";
import { LANDED_COST_COMPONENT_TYPES, LANDED_COST_CONFIDENCE, LANDED_COST_PHASES } from "../../../../../db/schema";

// Priority 12 (docs/production-readiness.md): the real read/write surface
// for lib/landed-cost.ts. GET follows the same view-access rule every
// other deal sub-resource uses (owner, assigned staff, or a recognized
// counterparty via deal_parties); POST is owner-only, matching this
// codebase's existing convention that deal economics are the owner's to
// report (see app/api/deals/route.ts's dealCosts insert, also owner-only
// by construction).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const dealId = Number((await params).id);
  const guard = await requireDealAccessOrResponse(request, dealId);
  if (guard instanceof Response) return guard;
  const breakdown = await getLandedCostBreakdown(dealId);
  return Response.json(breakdown);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const dealId = Number((await params).id);
  const guard = await requireDealAccessOrResponse(request, dealId);
  if (guard instanceof Response) return guard;
  const { user, access } = guard;
  if (!canManageDeal(access)) return Response.json({ error: "Only the deal owner can record landed-cost figures." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const componentType = String(body.componentType || "");
  if (!(LANDED_COST_COMPONENT_TYPES as readonly string[]).includes(componentType)) {
    return Response.json({ error: `componentType must be one of: ${LANDED_COST_COMPONENT_TYPES.join(", ")}` }, { status: 400 });
  }
  const phase = String(body.phase || "");
  if (!(LANDED_COST_PHASES as readonly string[]).includes(phase)) {
    return Response.json({ error: `phase must be one of: ${LANDED_COST_PHASES.join(", ")}` }, { status: 400 });
  }
  const expectedAmount = Number(body.expectedAmount);
  if (!Number.isFinite(expectedAmount) || expectedAmount < 0) {
    return Response.json({ error: "A real, non-negative expectedAmount is required." }, { status: 400 });
  }
  const lowAmount = body.lowAmount != null && body.lowAmount !== "" ? Number(body.lowAmount) : null;
  const highAmount = body.highAmount != null && body.highAmount !== "" ? Number(body.highAmount) : null;
  // A real sanity check — never let a fabricated or inverted range reach
  // the breakdown a trader reads as "how confident should I be."
  if (lowAmount != null && lowAmount > expectedAmount) {
    return Response.json({ error: "lowAmount cannot be greater than expectedAmount." }, { status: 400 });
  }
  if (highAmount != null && highAmount < expectedAmount) {
    return Response.json({ error: "highAmount cannot be less than expectedAmount." }, { status: 400 });
  }
  const confidence = body.confidence ? String(body.confidence) : "low";
  if (!(LANDED_COST_CONFIDENCE as readonly string[]).includes(confidence)) {
    return Response.json({ error: `confidence must be one of: ${LANDED_COST_CONFIDENCE.join(", ")}` }, { status: 400 });
  }
  // Recording an ACTUAL without saying where it came from would let a
  // number appear "final" with no way to check it later — a real source
  // is required specifically for this phase (estimates already default
  // to a stated, if low-confidence, source at deal creation).
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (phase === "actual" && !source) {
    return Response.json({ error: "A source is required when recording an actual cost." }, { status: 400 });
  }

  const entry = await recordLandedCostEntry({
    dealId,
    componentType: componentType as (typeof LANDED_COST_COMPONENT_TYPES)[number],
    phase: phase as "estimate" | "actual",
    lowAmount,
    expectedAmount,
    highAmount,
    currency: typeof body.currency === "string" ? body.currency : undefined,
    source,
    sourceDate: typeof body.sourceDate === "string" ? body.sourceDate : null,
    confidence: confidence as "low" | "medium" | "high",
    assumptions: typeof body.assumptions === "string" ? body.assumptions.trim() : "",
    isExcluded: body.isExcluded === true,
    recordedByEmail: user.email,
  });
  return Response.json({ entry }, { status: 201 });
}
