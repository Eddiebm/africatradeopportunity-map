import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { dealDocuments, deals, marketRequests, matchCandidates, verificationChecks } from "../../../../db/schema";

const ADMIN="eddie@bannermanmenson.com";
async function authorize(){const user=await getChatGPTUser();return user?.email.toLowerCase()===ADMIN?user:null}

export async function GET(){
 if(!await authorize())return Response.json({error:"Administrator access required."},{status:403});
 const db=getDb();const [dealRows,requestRows,checks,documents,matches]=await Promise.all([db.select().from(deals).orderBy(desc(deals.id)).limit(100),db.select().from(marketRequests).orderBy(desc(marketRequests.id)).limit(100),db.select().from(verificationChecks).orderBy(desc(verificationChecks.id)).limit(300),db.select().from(dealDocuments).orderBy(desc(dealDocuments.id)).limit(300),db.select().from(matchCandidates).orderBy(desc(matchCandidates.createdAt)).limit(200)]);
 return Response.json({deals:dealRows,requests:requestRows,checks,documents,matches});
}

export async function PATCH(req:Request){
 if(!await authorize())return Response.json({error:"Administrator access required."},{status:403});
 const body=await req.json() as {entity?:string;id?:number;status?:string};const numericId=Number(body.id);const status=String(body.status||"");
 if(!numericId||!body.entity)return Response.json({error:"Invalid record."},{status:400});
 const allowed:Record<string,string[]>={request:["pending_verification","contacted","verified","rejected"],deal:["intake","investigating","quoted","matched","contracting","in_transit","delivered","closed","rejected"],check:["required","submitted","verified","failed"],document:["required","submitted","approved","rejected"],match:["awaiting_counterparty","mutual_interest","approved","rejected"]};
 if(!allowed[body.entity]?.includes(status))return Response.json({error:"Invalid status."},{status:400});
 const db=getDb();
 if(body.entity==="request")await db.update(marketRequests).set({status}).where(eq(marketRequests.id,numericId));
 if(body.entity==="deal")await db.update(deals).set({stage:status,updatedAt:new Date().toISOString()}).where(eq(deals.id,numericId));
 if(body.entity==="check")await db.update(verificationChecks).set({status,reviewerEmail:ADMIN,checkedAt:new Date().toISOString()}).where(eq(verificationChecks.id,numericId));
 if(body.entity==="document")await db.update(dealDocuments).set({status,reviewedBy:ADMIN,reviewedAt:new Date().toISOString()}).where(eq(dealDocuments.id,numericId));
 if(body.entity==="match")await db.update(matchCandidates).set({status,updatedAt:new Date().toISOString()}).where(eq(matchCandidates.demandRequestId,numericId));
 return Response.json({ok:true});
}
