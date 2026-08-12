"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { RiskPanel } from "@/components/terminal/RiskPanel";
export default function RiskPage() { return <AuthenticatedTerminalPage activeRoute="risk" eyebrow="Risk engine · First-class safety" title="Risk management" description="Observe current paper exposure and the latest risk verdict. Unsupported limit editing and full kill behavior remain deliberately disabled.">{(status, refresh) => <RiskPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
