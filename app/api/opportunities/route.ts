import { desc } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { marketRequests } from "../../../db/schema";
import { getOrCreateOrganization } from "../../../lib/org";
import { assembleOpportunities, resolveHome } from "../../../lib/opportunities/assemble";
import { parseOrderText } from "../../../lib/opportunities/parse-order";
import type { LiveListing, ParsedOrder } from "../../../lib/opportunities/types";

async function loadListings(): Promise<LiveListing[]> {
  try {
    const rows = await getDb()
      .select({
        id: marketRequests.id,
        role: marketRequests.role,
        origin: marketRequests.origin,
        destination: marketRequests.destination,
        product: marketRequests.product,
        volume: marketRequests.volume,
        status: marketRequests.status,
        createdAt: marketRequests.createdAt,
      })
      .from(marketRequests)
      .orderBy(desc(marketRequests.id))
      .limit(80);
    return rows;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = resolveHome(url.searchParams.get("home"));
  const month = Number(url.searchParams.get("month") || "") || new Date().getUTCMonth() + 1;
  const listings = await loadListings();
  return Response.json(assembleOpportunities({ home, month, listings }));
}

function applyOverrides(parsed: ParsedOrder, body: Record<string, string>): ParsedOrder {
  return {
    ...parsed,
    role:
      body.role === "wanted" || body.role === "for_sale" || body.role === "freight_available"
        ? body.role
        : parsed.role,
    product: body.product?.trim() || parsed.product,
    hsCode: body.hsCode?.trim() || parsed.hsCode,
    origin: body.origin?.trim() || parsed.origin,
    destination: body.destination?.trim() || parsed.destination,
    volume: body.volume?.trim() || parsed.volume,
    targetPrice: body.targetPrice?.trim() || parsed.targetPrice,
    contact: body.contact?.trim() || parsed.contact,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const home = resolveHome(body.home || "");
  const parsed = parseOrderText(String(body.text || ""), home);
  const action = body.action === "submit" ? "submit" : "parse";
  if (action === "parse") return Response.json({ parsed });

  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required to post a pasted order." }, { status: 401 });

  const order = applyOverrides(parsed, body);
  if (!order.product || !order.origin || !order.destination || !order.volume || !order.contact) {
    return Response.json(
      { error: "Product, origin, destination, volume and a private contact are required.", parsed: order },
      { status: 400 },
    );
  }

  await getOrCreateOrganization(user, order.origin);
  const [row] = await getDb()
    .insert(marketRequests)
    .values({
      ownerEmail: user.email,
      role: order.role,
      origin: order.origin,
      destination: order.destination,
      product: order.product,
      hsCode: order.hsCode,
      volume: order.volume,
      targetPrice: order.targetPrice,
      contact: order.contact,
      status: "pending_verification",
    })
    .returning({ id: marketRequests.id, status: marketRequests.status });

  return Response.json({ request: row, parsed: order }, { status: 201 });
}
