import { getChatGPTUser } from "../../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { email: user.email, displayName: user.displayName, role: user.role || "trader" } });
}
