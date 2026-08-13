"use client";

import { useEffect, useState } from "react";
import NiftyVolumeChart, { type NiftyVolumePoint } from "@/components/NiftyVolumeChart";
import { jsonRequest } from "@/lib/controlClient";

type ResearchPayload={niftyVolumeSeries:NiftyVolumePoint[]};

export function DashboardVolumeCard(){
  const[points,setPoints]=useState<NiftyVolumePoint[]>([]);const[error,setError]=useState("");
  useEffect(()=>{let mounted=true;async function load(){try{const data=await jsonRequest<ResearchPayload>("/api/control/research");if(mounted){setPoints(data.niftyVolumeSeries??[]);setError("");}}catch(reason){if(mounted)setError(reason instanceof Error?reason.message:"Volume history unavailable");}}void load();const timer=window.setInterval(()=>void load(),15000);return()=>{mounted=false;window.clearInterval(timer);};},[]);
  return <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Whole NIFTY volume</p><h2>1-minute NIFTY-50 participation bars</h2></div><span>09:15 → current minute</span></div>{error&&<p className="availability-note">{error}</p>}<NiftyVolumeChart points={points}/></section>;
}
