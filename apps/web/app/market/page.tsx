"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { MarketOverviewPanel } from "@/components/terminal/MarketOverviewPanel";
export default function MarketPage() { return <AuthenticatedTerminalPage activeRoute="market" eyebrow="NIFTY workspace · Authenticated snapshots" title="Market overview" description="Monitor real worker-exposed spot, futures, basis, levels, data quality, and paper exposure without inventing unavailable chain or sector data.">{(status) => <MarketOverviewPanel status={status} />}</AuthenticatedTerminalPage>; }
