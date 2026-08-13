"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { MarketOverviewPanel } from "@/components/terminal/MarketOverviewPanel";
export default function MarketPage() { return <AuthenticatedTerminalPage activeRoute="market" eyebrow="NIFTY workspace · Authenticated snapshots" title="Market overview" description="Read persisted NIFTY-50 participation, constituent pressure proxies, sector breadth, futures context, and the near-ATM option chain.">{(status) => <MarketOverviewPanel status={status} />}</AuthenticatedTerminalPage>; }
