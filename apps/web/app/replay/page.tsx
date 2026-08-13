"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { ReplayPanel } from "@/components/terminal/ReplayPanel";
export default function ReplayPage() { return <AuthenticatedTerminalPage activeRoute="replay" eyebrow="Research foundation · Persisted market frames" title="Backtest / Market replay" description="Replay the same paper strategy and dynamic exits against market snapshots collected by Oracle.">{(status) => <ReplayPanel status={status} />}</AuthenticatedTerminalPage>; }
