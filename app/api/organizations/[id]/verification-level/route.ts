// Priority 6 (docs/production-readiness.md): "transparent verification
// levels" — a counterparty deciding whether to trust an organization
// needs to see its level without needing admin access. Public by design;
// deliberately returns ONLY the level number and which named levels were
// achieved — never the underlying evidence, notes, or reviewer identity
// (that detail stays admin-only, app/api/admin/organization-verifications/route.ts).
import { eq } from "drizzle-orm";
import { resolveOrganizationVerificationLevel } from "../../../../../lib/verification-levels";
import { getDb } from "../../../../../db";
import { organizations } from "../../../../../db/schema";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const organizationId = Number((await params).id);
  if (!organizationId) return Response.json({ error: "Organization not found." }, { status: 404 });

  const [org] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return Response.json({ error: "Organization not found." }, { status: 404 });

  const { level, achievedKeys } = await resolveOrganizationVerificationLevel(organizationId);
  return Response.json({ organizationId, level, achievedLevels: achievedKeys });
}
