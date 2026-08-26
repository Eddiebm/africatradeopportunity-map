import { comtradeCodeByName } from "../../../lib/africa-countries";

export async function GET(req:Request){
 const u=new URL(req.url),origin=u.searchParams.get("origin")||"",destination=u.searchParams.get("destination")||"",hs=(u.searchParams.get("hs")||"").replace(/\D/g,"").slice(0,6);
 if(!comtradeCodeByName[origin]||!comtradeCodeByName[destination]||!hs)return Response.json({error:"Select two listed African countries and an HS code."},{status:400});
 const source=`https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2024&reporterCode=${comtradeCodeByName[origin]}&partnerCode=${comtradeCodeByName[destination]}&flowCode=X&cmdCode=${hs}&maxRecords=500`;
 try{const res=await fetch(source,{headers:{accept:"application/json"}});if(!res.ok)throw new Error();const json=await res.json() as {data?:Array<{primaryValue?:number;netWgt?:number;qty?:number;period?:string;cmdDesc?:string}>};const rows=json.data||[];const value=rows.reduce((s,r)=>s+(r.primaryValue||0),0);const weight=rows.reduce((s,r)=>s+(r.netWgt||0),0);return Response.json({status:"official",source:"UN Comtrade preview API",period:"2024",origin,destination,hs,value,netWeightKg:weight,records:rows.length,sourceUrl:source,warning:rows.length?null:"No matching record returned; this is not proof that no informal trade occurred."});}
 catch{return Response.json({error:"UN Comtrade did not answer this lookup. Try the official source directly.",sourceUrl:source},{status:502})}
}
