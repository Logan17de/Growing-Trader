"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { StrategiesPanel } from "@/components/terminal/StrategiesPanel";
export default function StrategiesPage() { return <AuthenticatedTerminalPage activeRoute="strategies" eyebrow="Strategy operations · Paper only" title="Strategies" description="Observe the current level-event engine, inspect persisted reasoning, and use only the controls supported by the existing Oracle command pipeline.">{(status, refresh) => <StrategiesPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
