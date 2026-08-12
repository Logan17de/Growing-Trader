"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { PositionsPanel } from "@/components/terminal/PositionsPanel";
export default function PositionsPage() { return <AuthenticatedTerminalPage activeRoute="positions" eyebrow="Open inventory · Paper execution" title="Positions" description="View the paper engine's current position separately from order lifecycle, with unsupported marks and controls clearly disabled.">{(status) => <PositionsPanel status={status} />}</AuthenticatedTerminalPage>; }
