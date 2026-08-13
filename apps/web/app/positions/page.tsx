"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { PositionsPanel } from "@/components/terminal/PositionsPanel";
export default function PositionsPage() { return <AuthenticatedTerminalPage activeRoute="positions" eyebrow="Open inventory · PAPER / LIVE" title="Positions" description="View the active PAPER simulation or broker-backed LIVE position with current marks, unrealized P&L, and mode-aware exit controls.">{(status) => <PositionsPanel status={status} />}</AuthenticatedTerminalPage>; }
