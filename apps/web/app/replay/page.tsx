"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { ReplayPanel } from "@/components/terminal/ReplayPanel";
export default function ReplayPage() { return <AuthenticatedTerminalPage activeRoute="replay" eyebrow="Research foundation · No invented results" title="Backtest / Market replay" description="Define a typed historical replay request while keeping execution disabled until a historical snapshot and simulation service is deployed.">{() => <ReplayPanel />}</AuthenticatedTerminalPage>; }
