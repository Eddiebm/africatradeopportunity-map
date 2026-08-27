import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../../../../lib/auth/current-user";
import { resolveDealViewAccess } from "../../../../../../lib/auth/deal-access";
import { getDb } from "../../../../../../db";
import { documentAuditEvents, documentFiles } from "../../../../../../db/schema";
// docs/AUDIT.md §5 item 5: this used to check deals.ownerEmail only, so a
// legitimate counterparty (deal_parties) or assigned verification analyst
// had no path to download deal documents. resolveDealViewAccess() widens
// this to owner + platform staff + recognized counterparties — see
// lib/auth/deal-access.ts for exactly which relationships qualify and why
// this is a read-only widening, not a general access loosening.
export async function GET(request:Request,{params}:{params:Promise<{id:string;fileId:string}>}){const auth=await requireUserOrResponse(request);if(auth instanceof Response)return auth;const user=auth;const p=await params,dealId=Number(p.id),fileId=Number(p.fileId),db=getDb();const [access,[file]]=await Promise.all([resolveDealViewAccess(dealId,user),db.select().from(documentFiles).where(and(eq(documentFiles.id,fileId),eq(documentFiles.dealId,dealId),eq(documentFiles.fileStatus,"active"))).limit(1)]);if(!access||!file)return Response.json({error:"File not found."},{status:404});const object=await env.BUCKET.get(file.storageKey);if(!object)return Response.json({error:"Stored file unavailable."},{status:404});await db.insert(documentAuditEvents).values({documentFileId:file.id,dealId,actorEmail:user.email,action:"downloaded",details:`Download by ${access.reason.replaceAll("_"," ")}`});return new Response(object.body,{headers:{"content-type":file.contentType,"content-disposition":`attachment; filename="${file.originalName.replace(/["\\]/g,"_")}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}})}
