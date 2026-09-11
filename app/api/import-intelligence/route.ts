import { comtradeCodeByName, iso2ByName } from "../../../lib/africa-countries";
import { getImportIntelligence } from "../../../lib/trade-intelligence";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const country = query.get("country") || "";
  const hs = (query.get("hs") || "").replace(/\D/g, "").slice(0, 6);
  if (!comtradeCodeByName[country] || !iso2ByName[country] || !hs) {
    return Response.json({ error: "Select an African country and HS-coded product." }, { status: 400 });
  }
  try {
    const intel = await getImportIntelligence(country, hs);
    return Response.json(intel);
  } catch {
    return Response.json({ error: "Official trade records are temporarily unavailable for this query." }, { status: 502 });
  }
}
