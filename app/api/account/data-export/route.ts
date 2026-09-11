import { requireUserOrResponse } from "../../../../lib/auth/current-user";
import { buildUserDataExport } from "../../../../lib/data-export";

// Launch-prep follow-up (docs/production-readiness.md): self-service data
// export — see lib/data-export.ts's header comment for exactly what is and
// isn't included. Always the CALLER's own data (auth.id from the session),
// never a client-supplied user id.
export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;

  const data = await buildUserDataExport(auth.id);
  const body = JSON.stringify(data, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="tradesafe-africa-data-export-${auth.id}.json"`,
    },
  });
}
