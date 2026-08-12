"use client";
import { ActivityPanel } from "@/components/terminal/ActivityPanel";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
export default function ActivityPage() { return <AuthenticatedTerminalPage activeRoute="activity" eyebrow="Operational visibility · Sanitized" title="Alerts & logs" description="Review recent persisted signals, current service errors, and the latest control command without exposing credentials or authorization data.">{(status) => <ActivityPanel status={status} />}</AuthenticatedTerminalPage>; }
