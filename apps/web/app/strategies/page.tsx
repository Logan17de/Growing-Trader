"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { LiveStrategyCalculations } from "@/components/terminal/LiveStrategyCalculations";
import { StrategiesPanel } from "@/components/terminal/StrategiesPanel";
export default function StrategiesPage() { return <AuthenticatedTerminalPage activeRoute="strategies" eyebrow="Strategy operations · Paper / LIVE" title="Strategies" description="Observe the current level-event engine, inspect every live calculated input and score, edit DB-backed thresholds, and control paper or explicitly armed LIVE execution.">{(status, refresh) => <><StrategiesPanel status={status} refresh={refresh} /><LiveStrategyCalculations status={status}/></>}</AuthenticatedTerminalPage>; }
