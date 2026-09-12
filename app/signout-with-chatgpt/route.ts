import { GET as signOut } from "../signout/route";

export async function GET(req: Request) {
  return signOut(req);
}
