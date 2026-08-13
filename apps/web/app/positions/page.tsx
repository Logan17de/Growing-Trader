"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { PositionsPanel } from "@/components/terminal/PositionsPanel";
export default function PositionsPage() { return <AuthenticatedTerminalPage activeRoute="positions" eyebrow="Open inventory · Paper execution" title="Positions" description="Monitor the current paper option mark, protection levels, Greeks and manual paper-only position controls.">{(status, refresh) => <PositionsPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
