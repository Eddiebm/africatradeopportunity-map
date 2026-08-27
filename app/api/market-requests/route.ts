import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { marketRequests, organizationMembers } from "../../../db/schema";
import { getCurrentUserFromRequest } from "../../../lib/auth/current-user";
import { clientIp } from "../../../lib/auth/rate-limit";
import { turnstileEnforced, verifyTurnstile } from "../../../lib/turnstile";

export async function GET(){
  try { const rows=await getDb().select({id:marketRequests.id,role:marketRequests.role,origin:marketRequests.origin,destination:marketRequests.destination,product:marketRequests.product,volume:marketRequests.volume,status:marketRequests.status,createdAt:marketRequests.createdAt}).from(marketRequests).orderBy(desc(marketRequests.id)).limit(50); return Response.json({requests:rows}); }
  catch { return Response.json({requests:[]}); }
}
// Priority 9 (docs/production-readiness.md): "role":"quote_request" is the
// new low-friction entry point (app/quote/page.tsx) — origin is
// deliberately NOT in its required list ("origin if known" per the
// mission), unlike every other role, which the homepage's classifieds form
// still always supplies. Consent, by contrast, becomes MANDATORY only for
// this role — the other roles predate a consent concept entirely and
// reworking their forms is out of this priority's scope.
const BASE_REQUIRED=["role","destination","product","contact"];

export async function POST(req:Request){
  try{
    const user=await getCurrentUserFromRequest(req);
    const b=await req.json() as Record<string,string>;
    const isQuoteRequest=b.role==="quote_request";
    const required=isQuoteRequest?BASE_REQUIRED:[...BASE_REQUIRED,"origin","volume"];
    const turnstile=await verifyTurnstile(b.turnstileToken,clientIp(req));
    if(!turnstile.success&&turnstileEnforced()) return Response.json({error:"Verification failed. Please try again."},{status:400});
    if(required.some(k=>!b[k]?.trim())) return Response.json({error:"Complete every required field."},{status:400});
    if(isQuoteRequest&&!b.consent) return Response.json({error:"Consent is required to submit this request."},{status:400});
    const db=getDb();
    // Never trust a client-supplied organization id at face value — only
    // attach it if the signed-in user is actually an active member.
    // Protected introductions (see app/api/marketplace/route.ts) require
    // this to be set on both sides of a match; unset is fine too (falls
    // back to the original direct-consent flow).
    let organizationId:number|null=null;
    const requestedOrgId=Number(b.organizationId);
    if(user&&requestedOrgId){
      const [membership]=await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId,requestedOrgId),eq(organizationMembers.userId,user.id),eq(organizationMembers.status,"active"))).limit(1);
      if(membership)organizationId=requestedOrgId;
    }
    const quantity=Number(b.quantity);
    const [row]=await db.insert(marketRequests).values({
      ownerEmail:user?.email||null,organizationId,role:b.role.trim(),
      origin:b.origin?.trim()||"",destination:b.destination.trim(),product:b.product.trim(),
      hsCode:b.hsCode?.trim()||"",volume:b.volume?.trim()||"",targetPrice:b.targetPrice?.trim()||"",
      contact:b.contact.trim(),status:"pending_verification",
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      unit:b.unit?.trim()||"",productSpec:b.productSpec?.trim()||"",
      requiredDeliveryDate:b.requiredDeliveryDate?.trim()||null,
      existingQuoteNote:b.existingQuoteNote?.trim()||"",
      preferredContactMethod:b.preferredContactMethod?.trim()||"",
      consentAt:isQuoteRequest?new Date().toISOString():null,
    }).returning({id:marketRequests.id,status:marketRequests.status});
    return Response.json({request:row},{status:201});
  }catch{return Response.json({error:"The verification desk is temporarily unavailable."},{status:500})}
}
