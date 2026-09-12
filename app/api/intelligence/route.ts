import { buildDesk } from "../../../lib/intelligence/desk";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = Number(url.searchParams.get("month") || "") || new Date().getUTCMonth() + 1;
  const stance = url.searchParams.get("stance") || "all";
  const home = url.searchParams.get("home") || "Ghana";
  return Response.json(buildDesk({ home, month, stance }));
}
