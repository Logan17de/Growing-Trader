"use client";

import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { MarketWatchPanel } from "@/components/terminal/MarketWatchPanel";

export default function MarketWatchPage() {
  return <AuthenticatedTerminalPage
    activeRoute="marketWatch"
    eyebrow="Research only · Cross-market recorder · No execution"
    title="Market Watch"
    description="Study how NIFTY-50 participation, futures price/volume/OI, options positioning, VWAP, and market breadth behave before large NIFTY moves."
  >
    {() => <MarketWatchPanel />}
  </AuthenticatedTerminalPage>;
}
