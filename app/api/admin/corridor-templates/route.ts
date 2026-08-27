// Priority 5 (docs/production-readiness.md): administrator-only corridor
// template management. Full detail (including internal risk/escalation
// rules) — see app/api/corridor-templates/route.ts for the curated
// public view of the same data.
import { desc } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { createCorridorTemplateVersion, corridorKeyFor } from "../../../../lib/corridor-templates";
import { getDb } from "../../../../db";
import { corridorTemplates, CORRIDOR_TEMPLATE_CONFIDENCE, CORRIDOR_TEMPLATE_STATUSES, ORGANIZATION_ROLES, type CorridorTemplateStatus } from "../../../../db/schema";

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, ["administrator"]);
  if (auth instanceof Response) return auth;

  // Every version of every corridor — admins need the history, not just
  // the current state, to see how a corridor's rules evolved.
  const rows = await getDb().select().from(corridorTemplates).orderBy(desc(corridorTemplates.corridorKey), desc(corridorTemplates.version));
  return Response.json({ templates: rows });
}

export async function POST(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, ["administrator"]);
  if (auth instanceof Response) return auth;
  const user = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const origin = String(body.origin ?? "").trim();
  const destination = String(body.destination ?? "").trim();
  if (!origin || !destination) return Response.json({ error: "origin and destination are required." }, { status: 400 });

  const status = String(body.status ?? "draft") as CorridorTemplateStatus;
  if (!(CORRIDOR_TEMPLATE_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: `status must be one of: ${CORRIDOR_TEMPLATE_STATUSES.join(", ")}` }, { status: 400 });
  }
  const confidence = String(body.confidence ?? "low");
  if (!(CORRIDOR_TEMPLATE_CONFIDENCE as readonly string[]).includes(confidence)) {
    return Response.json({ error: `confidence must be one of: ${CORRIDOR_TEMPLATE_CONFIDENCE.join(", ")}` }, { status: 400 });
  }

  const sourceAttribution = String(body.sourceAttribution ?? "").trim();
  const reviewerEmail = String(body.reviewerEmail ?? "").trim();
  // The whole point of "draft / reviewed / operational" as distinct
  // statuses: a corridor cannot claim to be reviewed or operational
  // without an actual named reviewer and a named source for its rules.
  // This is the same "never fabricate verification" ethic this app
  // already applies everywhere else (see docs/AUDIT.md), enforced here
  // at the API boundary rather than left to whoever fills in the form.
  if ((status === "reviewed" || status === "operational") && (!sourceAttribution || !reviewerEmail)) {
    return Response.json(
      { error: "A 'reviewed' or 'operational' template requires both sourceAttribution and reviewerEmail — a status implying real review needs a real reviewer and a real source." },
      { status: 400 },
    );
  }

  const approvedPartnerRoles = Array.isArray(body.approvedPartnerRoles) ? (body.approvedPartnerRoles as unknown[]).map(String) : [];
  const invalidRole = approvedPartnerRoles.find((r) => !(ORGANIZATION_ROLES as readonly string[]).includes(r));
  if (invalidRole) return Response.json({ error: `Invalid partner role: ${invalidRole}` }, { status: 400 });

  const row = await createCorridorTemplateVersion({
    corridorKey: corridorKeyFor(origin, destination),
    origin,
    destination,
    productCategoriesJson: JSON.stringify(Array.isArray(body.productCategories) ? body.productCategories : []),
    requiredBuyerInfo: String(body.requiredBuyerInfo ?? ""),
    requiredSupplierInfo: String(body.requiredSupplierInfo ?? ""),
    requiredDocumentsJson: JSON.stringify(Array.isArray(body.requiredDocuments) ? body.requiredDocuments : []),
    verificationRequirements: String(body.verificationRequirements ?? ""),
    standardMilestonesJson: JSON.stringify(Array.isArray(body.standardMilestones) ? body.standardMilestones : []),
    evidenceRequiredJson: JSON.stringify(typeof body.evidenceRequired === "object" && body.evidenceRequired ? body.evidenceRequired : {}),
    approvedPartnerRolesJson: JSON.stringify(approvedPartnerRoles),
    expectedTiming: String(body.expectedTiming ?? ""),
    costComponentsJson: JSON.stringify(Array.isArray(body.costComponents) ? body.costComponents : []),
    riskRules: String(body.riskRules ?? ""),
    escalationRules: String(body.escalationRules ?? ""),
    sourceAttribution,
    reviewerEmail,
    confidence,
    status,
    createdByEmail: user.email,
  });

  return Response.json({ template: row }, { status: 201 });
}
