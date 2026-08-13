"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { ReplayPanel } from "@/components/terminal/ReplayPanel";
export default function ReplayPage() { return <AuthenticatedTerminalPage activeRoute="replay" eyebrow="Deterministic research · Stored market snapshots" title="Backtest / Market replay" description="Replay captured NIFTY market states through the real signal engine without inventing historical broker fills or P&L.">{(status) => <ReplayPanel status={status} />}</AuthenticatedTerminalPage>; }
