import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizations } from "../db/schema";
import type { TradeUser } from "./user";

export async function getOrCreateOrganization(user: TradeUser, country = "") {
  const db = getDb();
  const [existing] = await db.select().from(organizations).where(eq(organizations.ownerEmail, user.email)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(organizations)
    .values({
      ownerEmail: user.email,
      legalName: user.displayName,
      tradingName: user.fullName || user.displayName,
      country: country || "Unspecified",
      verificationStatus: "reported",
    })
    .returning();
  return created;
}
