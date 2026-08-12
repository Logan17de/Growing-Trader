export type SignalPayload = {
  timestamp: string;
  event: "breakout" | "reversal" | "uncertain" | "no_level";
  direction: "bullish" | "bearish" | "flat";
  confidence: number;
  combined_direction_score: number;
  cash: {
    pressure:number;
    breadth:number;
    participation:number;
    signed_volume_acceleration:number;
    score:number;
    advancers:number;
    decliners:number;
    heavyweight_score?:number;
    share_volume_delta?:number;
    turnover_delta?:number;
  };
  futures: {
    price_direction:number;
    volume_activity:number;
    oi_confirmation:number;
    basis_change:number;
    score:number;
  };
  option_market?: {
    score:number;
    volume_imbalance:number;
    oi_change_imbalance:number;
    iv_skew:number;
    call_volume_delta:number;
    put_volume_delta:number;
    call_oi_delta:number;
    put_oi_delta:number;
    contracts_used:number;
    ready:boolean;
  };
  vwap?: {
    synthetic_vwap:number|null;
    distance_bps:number;
    score:number;
    ready:boolean;
  };
  level: {
    event:string;
    event_score:number;
    breakout_score:number;
    reversal_score:number;
    distance_bps:number;
    level_name:string|null;
  };
  contract: {
    score:number;
    reason:string;
    contract:null|{
      trading_symbol:string;
      strike:number;
      option_type:"CE"|"PE";
      ltp:number;
    };
  };
  risk: { allowed:boolean; quantity:number; reason:string };
  reasons: string[];
};
