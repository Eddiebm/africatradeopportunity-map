import { desc } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { marketRequests } from "../../../db/schema";
import { getOrCreateOrganization } from "../../../lib/org";

export async function GET() {
  try {
    const rows = await getDb().select({
      id: marketRequests.id,
      role: marketRequests.role,
      origin: marketRequests.origin,
      destination: marketRequests.destination,
      product: marketRequests.product,
      volume: marketRequests.volume,
      status: marketRequests.status,
      createdAt: marketRequests.createdAt,
    }).from(marketRequests).orderBy(desc(marketRequests.id)).limit(50);
    return Response.json({ requests: rows });
  } catch {
    return Response.json({ requests: [] });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
    const body = await req.json() as Record<string, string>;
    const required = ["role", "origin", "destination", "product", "volume", "contact"];
    if (required.some((key) => !body[key]?.trim())) {
      return Response.json({ error: "Complete every required field." }, { status: 400 });
    }
    await getOrCreateOrganization(user, body.origin);
    const [row] = await getDb().insert(marketRequests).values({
      ownerEmail: user.email,
      role: body.role.trim(),
      origin: body.origin.trim(),
      destination: body.destination.trim(),
      product: body.product.trim(),
      hsCode: body.hsCode?.trim() || "",
      volume: body.volume.trim(),
      targetPrice: body.targetPrice?.trim() || "",
      contact: body.contact.trim(),
      status: "pending_verification",
    }).returning({ id: marketRequests.id, status: marketRequests.status });
    return Response.json({ request: row }, { status: 201 });
  } catch {
    return Response.json({ error: "The verification desk is temporarily unavailable." }, { status: 500 });
  }
}
