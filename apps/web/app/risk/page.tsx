"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { RiskPanel } from "@/components/terminal/RiskPanel";
export default function RiskPage() { return <AuthenticatedTerminalPage activeRoute="risk" eyebrow="Risk engine · First-class safety" title="Risk management" description="Edit DB-backed paper risk limits, monitor exposure and control the persistent paper kill switch.">{(status, refresh) => <RiskPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
