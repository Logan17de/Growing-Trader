"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { MarketOverviewPanel } from "@/components/terminal/MarketOverviewPanel";
export default function MarketPage() { return <AuthenticatedTerminalPage activeRoute="market" eyebrow="NIFTY workspace · Authenticated snapshots" title="Market overview" description="Monitor spot, futures, 50-stock participation, option-chain structure and market-data collection independently from strategy entry state.">{(status, refresh) => <MarketOverviewPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
