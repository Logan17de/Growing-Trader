"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { OrdersPanel } from "@/components/terminal/OrdersPanel";
export default function OrdersPage() { return <AuthenticatedTerminalPage activeRoute="orders" eyebrow="Order lifecycle · PAPER / LIVE" title="Orders" description="Filter persisted simulated and broker orders by mode, lifecycle, date, instrument, and side while preserving broker reference IDs.">{(status) => <OrdersPanel status={status} />}</AuthenticatedTerminalPage>; }
