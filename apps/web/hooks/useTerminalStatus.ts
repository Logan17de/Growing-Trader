"use client";

import { useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/controlClient";
import type { ControlStatus, TradingDataSnapshot } from "@/lib/terminalTypes";

export type TerminalAuthState = "checking" | "guest" | "ready";

type ConfigResponse = { appSettings?: Array<{ key:string; value:unknown }> };
function unavailableStatus(message:string):ControlStatus{return{controlPlane:{healthy:false,errors:{status:message}},worker:{online:false,stale:false,state:"offline",market_data_status:"unavailable"},paperEngine:{running:false,state:"unavailable",feed_connected:false},latestCommand:null,credentials:{configured:false,updatedAt:null},latestSignal:null,recentSignals:[],levels:[],paperOrders:[],paperTrades:[],paperOutcomes:[]};}

export function useTerminalStatus(pollIntervalMs?:number){const[auth,setAuth]=useState<TerminalAuthState>("checking");const[status,setStatus]=useState<ControlStatus|null>(null);const[error,setError]=useState("");const[refreshing,setRefreshing]=useState(false);const[configuredPollMs,setConfiguredPollMs]=useState(pollIntervalMs??3000);
const refreshTradingData=useCallback(async()=>{try{const data=await jsonRequest<TradingDataSnapshot>("/api/control/trading");setStatus((current)=>current?{...current,...data}:current);}catch(reason){const message=reason instanceof Error?reason.message:"Unable to load trading history";if(message==="unauthorized")setAuth("guest");else setError((current)=>current||`Trading history: ${message}`);}},[]);
const refresh=useCallback(async(background=false)=>{if(!background)setRefreshing(true);try{const data=await jsonRequest<ControlStatus>("/api/control/status");setStatus((current)=>({...data,recentSignals:data.recentSignals??current?.recentSignals??[],paperOrders:data.paperOrders??current?.paperOrders??[],paperTrades:data.paperTrades??current?.paperTrades??[],paperOutcomes:data.paperOutcomes??current?.paperOutcomes??[]}));setAuth("ready");setError("");}catch(reason){const message=reason instanceof Error?reason.message:"Unable to load terminal status";if(message==="unauthorized"){setAuth("guest");setStatus(null);}else{setAuth("ready");setError(message);setStatus((current)=>current??unavailableStatus(message));}}finally{if(!background)setRefreshing(false);}},[]);
useEffect(()=>{void jsonRequest<{authenticated:boolean}>("/api/auth/status").then((result)=>result.authenticated?refresh():setAuth("guest")).catch(()=>setAuth("guest"));},[refresh]);
useEffect(()=>{if(auth!=="ready"||pollIntervalMs!==undefined)return;void jsonRequest<ConfigResponse>("/api/control/config").then((data)=>{const row=data.appSettings?.find((item)=>item.key==="dashboard_refresh_ms");const parsed=Number(row?.value);if(Number.isFinite(parsed))setConfiguredPollMs(Math.min(Math.max(parsed,1000),60000));}).catch(()=>undefined);},[auth,pollIntervalMs]);
useEffect(()=>{const interval=pollIntervalMs??configuredPollMs;if(auth!=="ready"||interval<=0)return;const timer=window.setInterval(()=>void refresh(true),interval);return()=>window.clearInterval(timer);},[auth,pollIntervalMs,configuredPollMs,refresh]);
useEffect(()=>{if(auth!=="ready")return;void refreshTradingData();const timer=window.setInterval(()=>void refreshTradingData(),15000);return()=>window.clearInterval(timer);},[auth,refreshTradingData]);
const logout=useCallback(async()=>{await fetch("/api/auth/logout",{method:"POST"});setStatus(null);setAuth("guest");},[]);const refreshAll=useCallback(async()=>{await refresh();await refreshTradingData();},[refresh,refreshTradingData]);return{auth,status,error,refreshing,refresh:refreshAll,logout,pollIntervalMs:pollIntervalMs??configuredPollMs};}
