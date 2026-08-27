// Priority 6 (docs/production-readiness.md): recording an organization's
// verification-level facts. Administrator or verification_analyst only —
// the same roles that already act as reviewers everywhere else in this
// app (admin desk, dispute internal messages).
import { eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { getVerificationHistory, recordOrganizationVerification, resolveOrganizationVerificationLevel } from "../../../../lib/verification-levels";
import { getDb } from "../../../../db";
import { organizations, VERIFICATION_LEVELS } from "../../../../db/schema";

const REVIEWER_ROLES: ("administrator" | "verification_analyst")[] = ["administrator", "verification_analyst"];

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, REVIEWER_ROLES);
  if (auth instanceof Response) return auth;

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const [history, current] = await Promise.all([
    getVerificationHistory(organizationId),
    resolveOrganizationVerificationLevel(organizationId),
  ]);
  return Response.json({ history, currentLevel: current.level, achievedKeys: current.achievedKeys });
}

export async function POST(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, REVIEWER_ROLES);
  if (auth instanceof Response) return auth;
  const user = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const organizationId = Number(body.organizationId);
  if (!organizationId) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const [org] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return Response.json({ error: "Organization not found." }, { status: 404 });

  const levelKey = String(body.levelKey ?? "");
  if (!(VERIFICATION_LEVELS as readonly string[]).includes(levelKey)) {
    return Response.json({ error: `levelKey must be one of: ${VERIFICATION_LEVELS.join(", ")}` }, { status: 400 });
  }
  const result = String(body.result ?? "pending");
  if (!["pending", "passed", "failed"].includes(result)) {
    return Response.json({ error: "result must be pending, passed, or failed." }, { status: 400 });
  }
  // Per docs/AUDIT.md's AI boundary and this table's own contract
  // (db/schema.ts): a 'passed' result that counts toward an
  // organization's level (humanReviewRequired: false) requires a real
  // named reviewer and a real source — not just a checkbox. This is
  // enforced here, at the only route that can ever set
  // humanReviewRequired: false, not left as documentation.
  const humanReviewRequired = body.humanReviewRequired !== false;
  const source = String(body.source ?? "").trim();
  const reviewerEmail = String(body.reviewerEmail ?? "").trim();
  if (result === "passed" && !humanReviewRequired && (!source || !reviewerEmail)) {
    return Response.json(
      { error: "A passed result with humanReviewRequired:false requires both source and reviewerEmail — a level cannot count without a real reviewer and a real source." },
      { status: 400 },
    );
  }

  const row = await recordOrganizationVerification({
    organizationId,
    levelKey: levelKey as (typeof VERIFICATION_LEVELS)[number],
    whatWasChecked: String(body.whatWasChecked ?? ""),
    performedByEmail: user.email,
    evidenceFileId: body.evidenceFileId != null ? Number(body.evidenceFileId) : null,
    source,
    result: result as "pending" | "passed" | "failed",
    reviewerEmail,
    notes: String(body.notes ?? ""),
    humanReviewRequired,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
  });

  const current = await resolveOrganizationVerificationLevel(organizationId);
  return Response.json({ verification: row, currentLevel: current.level }, { status: 201 });
}
