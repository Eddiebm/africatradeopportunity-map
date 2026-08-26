import { and, desc, eq, or } from "drizzle-orm";
import { requireUserOrResponse } from "../../../lib/auth/current-user";
import { getDb } from "../../../db";
import { marketRequests, matchCandidates, notifications } from "../../../db/schema";

const compatible=(a:string,b:string)=>(a==="wanted"&&b==="for_sale")||(a==="for_sale"&&b==="wanted");
const productKey=(s:string)=>s.toLowerCase().replace(/^\d{4,6}\s*[—-]?\s*/,"").replace(/[^a-z0-9]+/g," ").trim();
const score=(a:typeof marketRequests.$inferSelect,b:typeof marketRequests.$inferSelect)=>{
  const product=productKey(a.product)===productKey(b.product)||a.hsCode&&b.hsCode&&a.hsCode.slice(0,4)===b.hsCode.slice(0,4)?40:0;
  const route=a.origin===b.origin&&a.destination===b.destination?35:a.destination===b.destination?15:0;
  const verified=b.status==="verified"?15:0;
  return {total:product+route+verified+10,breakdown:{product,route,verified,listingCompleteness:10}};
};

export async function GET(request:Request){
 const auth=await requireUserOrResponse(request);if(auth instanceof Response)return auth;const user=auth;
 const db=getDb();const [mine,all,matches]=await Promise.all([
  db.select().from(marketRequests).where(eq(marketRequests.ownerEmail,user.email)).orderBy(desc(marketRequests.id)),
  db.select().from(marketRequests).where(eq(marketRequests.status,"verified")).orderBy(desc(marketRequests.id)).limit(200),
  db.select().from(matchCandidates).orderBy(desc(matchCandidates.createdAt)).limit(200)
 ]);
 const suggestions=mine.flatMap(own=>all.filter(other=>other.id!==own.id&&compatible(own.role,other.role)).map(other=>({ownId:own.id,counterpart:{id:other.id,role:other.role,product:other.product,origin:other.origin,destination:other.destination,volume:other.volume,status:other.status},...score(own,other)}))).filter(x=>x.total>=65).sort((a,b)=>b.total-a.total);
 const relevant=matches.filter(m=>mine.some(x=>x.id===m.demandRequestId||x.id===m.supplyRequestId));
 const active=relevant.map(m=>{const demand=all.concat(mine).find(x=>x.id===m.demandRequestId),supply=all.concat(mine).find(x=>x.id===m.supplyRequestId);const ownIsDemand=mine.some(x=>x.id===m.demandRequestId);const counterpart=ownIsDemand?supply:demand;return {...m,counterpart:counterpart?{id:counterpart.id,product:counterpart.product,origin:counterpart.origin,destination:counterpart.destination,volume:counterpart.volume,contact:m.status==="approved"?counterpart.contact:"Contact withheld until mutual consent and review"}:null};});
 return Response.json({mine,suggestions:suggestions.slice(0,50),matches:active});
}

export async function POST(req:Request){
 const auth=await requireUserOrResponse(req);if(auth instanceof Response)return auth;const user=auth;
 const body=await req.json() as {ownId?:number;counterpartId?:number};const ownId=Number(body.ownId),counterpartId=Number(body.counterpartId);if(!ownId||!counterpartId)return Response.json({error:"Choose a valid match."},{status:400});
 const db=getDb();const [[own],[other]]=await Promise.all([db.select().from(marketRequests).where(and(eq(marketRequests.id,ownId),eq(marketRequests.ownerEmail,user.email))).limit(1),db.select().from(marketRequests).where(and(eq(marketRequests.id,counterpartId),eq(marketRequests.status,"verified"))).limit(1)]);
 if(!own||!other||!compatible(own.role,other.role))return Response.json({error:"This match is no longer available."},{status:409});
 const demand=own.role==="wanted"?own:other,supply=own.role==="for_sale"?own:other,id=`M-${demand.id}-${supply.id}`;let [match]=await db.select().from(matchCandidates).where(eq(matchCandidates.id,id)).limit(1);const now=new Date().toISOString();
 if(!match){[match]=await db.insert(matchCandidates).values({id,demandRequestId:demand.id,supplyRequestId:supply.id,score:score(own,other).total,scoreBreakdown:JSON.stringify(score(own,other).breakdown),status:"awaiting_counterparty",demandInterestAt:own.role==="wanted"?now:null,supplyInterestAt:own.role==="for_sale"?now:null}).returning();}
 else await db.update(matchCandidates).set(own.role==="wanted"?{demandInterestAt:now,updatedAt:now}:{supplyInterestAt:now,updatedAt:now}).where(eq(matchCandidates.id,id));
 if(other.ownerEmail)await db.insert(notifications).values({recipientEmail:other.ownerEmail,eventType:"match_interest",entityType:"match",entityId:other.id,titleKey:"match.interest.title",bodyKey:"match.interest.body",payloadJson:JSON.stringify({matchId:id,product:own.product})});
 return Response.json({ok:true,matchId:id});
}

export async function PATCH(req:Request){
 const auth=await requireUserOrResponse(req);if(auth instanceof Response)return auth;const user=auth;const body=await req.json() as {matchId?:string};if(!body.matchId)return Response.json({error:"Match required."},{status:400});
 const db=getDb();const [match]=await db.select().from(matchCandidates).where(eq(matchCandidates.id,body.matchId)).limit(1);if(!match)return Response.json({error:"Match not found."},{status:404});
 const owned=await db.select().from(marketRequests).where(and(eq(marketRequests.ownerEmail,user.email),or(eq(marketRequests.id,match.demandRequestId),eq(marketRequests.id,match.supplyRequestId)))).limit(1);if(!owned[0])return Response.json({error:"Not authorized."},{status:403});const now=new Date().toISOString();
 const demandOwned=owned[0].id===match.demandRequestId;const demandAt=demandOwned?now:match.demandInterestAt,supplyAt=demandOwned?match.supplyInterestAt:now;await db.update(matchCandidates).set({demandInterestAt:demandAt,supplyInterestAt:supplyAt,status:demandAt&&supplyAt?"mutual_interest":"awaiting_counterparty",updatedAt:now}).where(eq(matchCandidates.id,match.id));return Response.json({ok:true,status:demandAt&&supplyAt?"mutual_interest":"awaiting_counterparty"});
}
