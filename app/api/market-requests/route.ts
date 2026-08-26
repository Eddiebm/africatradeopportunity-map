import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { marketRequests } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET(){
  try { const rows=await getDb().select({id:marketRequests.id,role:marketRequests.role,origin:marketRequests.origin,destination:marketRequests.destination,product:marketRequests.product,volume:marketRequests.volume,status:marketRequests.status,createdAt:marketRequests.createdAt}).from(marketRequests).orderBy(desc(marketRequests.id)).limit(50); return Response.json({requests:rows}); }
  catch { return Response.json({requests:[]}); }
}
export async function POST(req:Request){
  try{
    const user=await getChatGPTUser();
    const b=await req.json() as Record<string,string>; const required=["role","origin","destination","product","volume","contact"];
    if(required.some(k=>!b[k]?.trim())) return Response.json({error:"Complete every required field."},{status:400});
    const [row]=await getDb().insert(marketRequests).values({ownerEmail:user?.email||null,role:b.role.trim(),origin:b.origin.trim(),destination:b.destination.trim(),product:b.product.trim(),hsCode:b.hsCode?.trim()||"",volume:b.volume.trim(),targetPrice:b.targetPrice?.trim()||"",contact:b.contact.trim(),status:user?"pending_verification":"pending_verification"}).returning({id:marketRequests.id,status:marketRequests.status});
    return Response.json({request:row},{status:201});
  }catch{return Response.json({error:"The verification desk is temporarily unavailable."},{status:500})}
}
