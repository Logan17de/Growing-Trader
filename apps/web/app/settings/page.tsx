"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { SettingsPanel } from "@/components/terminal/SettingsPanel";
export default function SettingsPage() { return <AuthenticatedTerminalPage activeRoute="settings" eyebrow="Terminal configuration · Secure boundaries" title="Settings" description="Manage encrypted Groww credentials, paper runtime defaults and persisted terminal preferences.">{(status, refresh) => <SettingsPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
