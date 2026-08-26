import { desc, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../lib/auth/current-user";
import { getDb } from "../../../db";
import { notifications } from "../../../db/schema";
const copy:Record<string,[string,string]>={"match_interest":["A trader expressed interest","Open your matching desk to review the proposed corridor and confirm whether you want an introduction."],"dispute_opened":["Dispute case opened","Your report has been recorded and added to the deal audit trail."]};
export async function GET(request:Request){const auth=await requireUserOrResponse(request);if(auth instanceof Response)return auth;const user=auth;const rows=await getDb().select().from(notifications).where(eq(notifications.recipientEmail,user.email)).orderBy(desc(notifications.id)).limit(100);return Response.json({notifications:rows.map(x=>({...x,title:copy[x.eventType]?.[0]||x.titleKey,body:copy[x.eventType]?.[1]||x.bodyKey}))})}
export async function PATCH(request:Request){const auth=await requireUserOrResponse(request);if(auth instanceof Response)return auth;const user=auth;await getDb().update(notifications).set({readAt:new Date().toISOString(),status:"read"}).where(eq(notifications.recipientEmail,user.email));return Response.json({ok:true})}
