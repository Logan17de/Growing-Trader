"use client";
import { AnalyticsPanel } from "@/components/terminal/AnalyticsPanel";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
export default function AnalyticsPage() { return <AuthenticatedTerminalPage activeRoute="analytics" eyebrow="Paper performance · Realized records" title="Analytics" description="Evaluate P&L and outcome metrics derived only from persisted paper trades, with unsupported execution analytics labeled unavailable.">{(status) => <AnalyticsPanel status={status} />}</AuthenticatedTerminalPage>; }
