import { africanComtradeCodes, comtradeCodeByName, iso2ByName } from "../../../lib/africa-countries";

type Row={period?:string|number;primaryValue?:number;netWgt?:number;cmdDesc?:string;isReported?:boolean;partnerCode?:number;partnerDesc?:string};
const year = new Date().getUTCFullYear();
const completedMonth = new Date().getUTCMonth();
const annualYears = Array.from({length:6},(_,i)=>String(year-6+i));
const monthlyPeriods = Array.from({length:Math.max(0,completedMonth)},(_,i)=>`${year}${String(i+1).padStart(2,"0")}`);
const endpoint=(frequency:"A"|"M",period:string,reporter:string,hs:string)=>`https://comtradeapi.un.org/public/v1/preview/C/${frequency}/HS?period=${period}&reporterCode=${reporter}&partnerCode=0&partner2Code=0&flowCode=M&cmdCode=${hs}&customsCode=C00&motCode=0&maxRecords=500&aggregateBy=6&breakdownMode=classic&includeDesc=true`;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

async function rows(url:string){const response=await fetch(url,{headers:{accept:"application/json"}});if(!response.ok)throw new Error("source unavailable");const data=await response.json() as {data?:Row[]};return data.data||[]}
async function optionalRows(url:string){try{return await rows(url)}catch{return []}}
async function indicator(iso2:string,code:string){try{const url=`https://api.worldbank.org/v2/country/${iso2}/indicator/${code}?format=json&per_page=8`;const response=await fetch(url);const body=await response.json() as [unknown,Array<{date:string;value:number|null}>?];const found=body?.[1]?.find(x=>x.value!==null);return {value:found?.value||0,period:found?.date||"",url}}catch{return {value:0,period:"",url:""}}}

export async function GET(req:Request){
  const query=new URL(req.url).searchParams;
  const country=query.get("country")||"";
  const hs=(query.get("hs")||"").replace(/\D/g,"").slice(0,6);
  const reporter=comtradeCodeByName[country];
  const iso2=iso2ByName[country];
  if(!reporter||!hs)return Response.json({error:"Select an African country and HS-coded product."},{status:400});
  const annualUrl=endpoint("A",annualYears.join(","),reporter,hs);
  const monthlyUrl=monthlyPeriods.length?endpoint("M",monthlyPeriods.join(","),reporter,hs):"";
  const partnerUrl=`https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=${year-1}&reporterCode=${reporter}&partnerCode=all&flowCode=M&cmdCode=${hs}&maxRecords=500&includeDesc=true`;
  try{
    const [annualRows,monthlyRows,partnerRows,populationGrowth,gdpGrowth]=await Promise.all([rows(annualUrl),monthlyUrl?optionalRows(monthlyUrl):Promise.resolve([]),optionalRows(partnerUrl),indicator(iso2,"SP.POP.GROW"),indicator(iso2,"NY.GDP.MKTP.KD.ZG")]);
    const annual=annualYears.map(period=>{const found=annualRows.filter(r=>String(r.period)===period);return {period,value:found.reduce((sum,r)=>sum+(r.primaryValue||0),0),netWeightKg:found.reduce((sum,r)=>sum+(r.netWgt||0),0),status:found.length?(found.every(r=>r.isReported!==false)?"official":"official-estimated"):"not-reported"}});
    const active=annual.filter(x=>x.value>0);
    const currentValue=monthlyRows.reduce((sum,r)=>sum+(r.primaryValue||0),0);
    const monthsReported=new Set(monthlyRows.map(r=>String(r.period))).size;
    const annualizedCurrent=monthsReported?currentValue/monthsReported*12:0;
    const first=active[0],last=active.at(-1);
    const spans=first&&last?Math.max(1,+last.period-+first.period):1;
    const cagr=first&&last&&first.value>0?Math.pow(last.value/first.value,1/spans)-1:0;
    const recentBase=annualizedCurrent||last?.value||0;
    const momentum=annualizedCurrent&&last?.value?annualizedCurrent/last.value-1:cagr;
    const demandTailwind=clamp((populationGrowth.value*.4+gdpGrowth.value*.25)/100,-.04,.08);
    const forecastRate=clamp(cagr*.6+momentum*.3+demandTailwind,-.3,.5);
    const forecast=recentBase?recentBase*(1+forecastRate):0;
    const observations=active.length+Math.min(3,monthsReported/3);
    const confidence=Math.round(clamp(35+observations*7+(monthsReported>=3?10:0),25,92));
    const direction=forecastRate>.08?"rising":forecastRate<-.08?"falling":"stable";
    const worldRow=partnerRows.find(r=>Number(r.partnerCode)===0);const worldImports=worldRow?.primaryValue||last?.value||0;
    const africanSuppliers=partnerRows.filter(r=>r.partnerCode&&africanComtradeCodes.has(String(r.partnerCode))&&Number(r.partnerCode)!==Number(reporter)&&Number(r.primaryValue)>0).sort((a,b)=>(b.primaryValue||0)-(a.primaryValue||0)).slice(0,8).map(r=>({country:r.partnerDesc||`Partner ${r.partnerCode}`,value:r.primaryValue||0,netWeightKg:r.netWgt||0,share:worldImports?(r.primaryValue||0)/worldImports:0,status:"official-partner-record"}));
    return Response.json({country,hs,product:annualRows[0]?.cmdDesc||`HS ${hs}`,annual,current:{year,monthsReported,value:currentValue,annualizedValue:annualizedCurrent,status:monthsReported?"official-monthly":"not-yet-reported"},outlook:{nextYear:year+1,value:forecast,direction,growthRate:forecastRate,confidence,method:"Projection combining historical import growth, recent monthly momentum, population growth and real GDP growth",drivers:{populationGrowth,gdpGrowth}},supply:{period:year-1,worldImports,africanSuppliers,status:africanSuppliers.length?"official-recorded-supply":"no-african-supplier-record-returned"},sources:[{name:"UN Comtrade",type:"official trade",url:annualUrl},{name:"World Bank Open Data",type:"official development indicators",url:populationGrowth.url},{name:"WITS / UNCTAD TRAINS",type:"tariffs and non-tariff measures",url:"https://wits.worldbank.org/"},{name:"FAOSTAT",type:"agricultural production and food balances",url:"https://www.fao.org/faostat/en/"},{name:"AfCFTA Secretariat",type:"continental trade rules",url:"https://www.africancfta.org/"}],warnings:["Future demand is a projection, not a purchase order.","Missing official records do not prove that no formal or informal imports occurred.","Current-year values cover only months returned by the reporting country."]});
  }catch{return Response.json({error:"Official trade records are temporarily unavailable for this query.",source:annualUrl},{status:502})}
}
