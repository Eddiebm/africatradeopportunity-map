import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isAdminEmail } from "../../../lib/session";
import { assemblePack } from "../../../lib/prices/assemble";
import { readPricePack, refreshReferencePrices } from "../../../lib/prices/refresh";

type PriceEnv = { PRICE_REFRESH_SECRET?: string };

async function canRefresh(request: Request): Promise<boolean> {
  const user = await getChatGPTUser();
  if (user && (user.role === "admin" || isAdminEmail(user.email))) return true;
  const secret = (env as typeof env & PriceEnv).PRICE_REFRESH_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-price-refresh-secret") || "";
  return token === secret;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hs = url.searchParams.get("hs") || "";
  const origin = url.searchParams.get("origin") || "";
  const destination = url.searchParams.get("destination") || "";
  const volume = url.searchParams.get("volume") || "";
  try {
    return Response.json(await readPricePack({ hs, origin, destination, volume }));
  } catch {
    return Response.json(assemblePack([], null));
  }
}

export async function POST(request: Request) {
  if (!(await canRefresh(request))) {
    return Response.json({ error: "Administrator or refresh secret required." }, { status: 403 });
  }
  try {
    const result = await refreshReferencePrices();
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Refresh failed." },
      { status: 502 },
    );
  }
}
