const codes:Record<string,string>={"Ghana":"288","Burkina Faso":"854","Togo":"768","Nigeria":"566","Benin":"204","Côte d’Ivoire":"384","Senegal":"686","Mali":"466","Niger":"562"};
export async function GET(req:Request){
 const u=new URL(req.url),origin=u.searchParams.get("origin")||"",destination=u.searchParams.get("destination")||"",hs=(u.searchParams.get("hs")||"").replace(/\D/g,"").slice(0,6);
 if(!codes[origin]||!codes[destination]||!hs)return Response.json({error:"Official live lookup currently covers the initial West African corridor."},{status:400});
 const source=`https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2024&reporterCode=${codes[origin]}&partnerCode=${codes[destination]}&flowCode=X&cmdCode=${hs}&maxRecords=500`;
 try{const res=await fetch(source,{headers:{accept:"application/json"}});if(!res.ok)throw new Error();const json=await res.json() as {data?:Array<{primaryValue?:number;netWgt?:number;qty?:number;period?:string;cmdDesc?:string}>};const rows=json.data||[];const value=rows.reduce((s,r)=>s+(r.primaryValue||0),0);const weight=rows.reduce((s,r)=>s+(r.netWgt||0),0);return Response.json({status:"official",source:"UN Comtrade preview API",period:"2024",origin,destination,hs,value,netWeightKg:weight,records:rows.length,sourceUrl:source,warning:rows.length?null:"No matching record returned; this is not proof that no informal trade occurred."});}
 catch{return Response.json({error:"UN Comtrade did not answer this lookup. Try the official source directly.",sourceUrl:source},{status:502})}
}
