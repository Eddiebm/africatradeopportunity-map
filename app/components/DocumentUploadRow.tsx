"use client";
import {useState} from "react";
// canUpload defaults true so existing owner-only call sites don't need to
// change; the deal room page passes canUpload={isOwner} explicitly (see
// lib/auth/deal-access.ts) so a counterparty/verification-analyst viewer
// can see and download documents without a dead-end upload control the
// server would reject anyway (upload stays owner-only — see deal-access.ts's
// header comment for why that's intentional, not an oversight).
export default function DocumentUploadRow({dealId,documentId,name,status,fileId,fileName,canUpload=true}:{dealId:number;documentId:number;name:string;status:string;fileId?:number;fileName?:string;canUpload?:boolean}){const [state,setState]=useState(status),[message,setMessage]=useState("");async function upload(file:File){setMessage("Uploading securely…");const form=new FormData();form.set("documentId",String(documentId));form.set("file",file);const r=await fetch(`/api/deals/${dealId}/documents`,{method:"POST",body:form});const d=(await r.json()) as {error?:string};if(r.ok){setState("submitted");setMessage("Submitted for review. Refresh to see the audit trail.")}else setMessage(d.error||"Upload failed.")}return <div className="task docrow"><i>{state==="approved"?"✓":state==="submitted"?"↑":"—"}</i><span><b>{name.replaceAll("_"," ")}</b><small>{state}{fileName?` · ${fileName}`:""}</small><em>{message}</em></span>{canUpload&&<label className="uploadbtn">{state==="required"?"Upload":"Replace"}<input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>{const f=e.target.files?.[0];if(f)upload(f)}}/></label>}{fileId&&<a className="downloadbtn" href={`/api/deals/${dealId}/documents/${fileId}`}>Download</a>}</div>}
