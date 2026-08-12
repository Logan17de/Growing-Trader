"use client";
import { AuthenticatedTerminalPage } from "@/components/terminal/AuthenticatedTerminalPage";
import { OrdersPanel } from "@/components/terminal/OrdersPanel";
export default function OrdersPage() { return <AuthenticatedTerminalPage activeRoute="orders" eyebrow="Order lifecycle · Persisted paper records" title="Orders" description="Filter real paper-order records by lifecycle, date, instrument, and side. No presentation component can place or cancel broker orders.">{(status) => <OrdersPanel status={status} />}</AuthenticatedTerminalPage>; }
