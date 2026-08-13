"use client";
import { AnalyticsPanel } from "@/components/terminal/AnalyticsPanel";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
export default function AnalyticsPage() { return <AuthenticatedTerminalPage activeRoute="analytics" eyebrow="PAPER / LIVE performance · Realized records" title="Analytics" description="Evaluate persisted PAPER simulations and broker-reconciled LIVE fills separately, with side-by-side comparison and signal-event attribution.">{(status) => <AnalyticsPanel status={status} />}</AuthenticatedTerminalPage>; }
