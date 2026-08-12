"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { SettingsPanel } from "@/components/terminal/SettingsPanel";
export default function SettingsPage() { return <AuthenticatedTerminalPage activeRoute="settings" eyebrow="Terminal configuration · Secure boundaries" title="Settings" description="Manage the existing encrypted Groww credential flow and inspect which application settings still require backend persistence.">{(status, refresh) => <SettingsPanel status={status} refresh={refresh} />}</AuthenticatedTerminalPage>; }
