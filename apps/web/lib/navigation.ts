import type { IconName } from "@/components/terminal/Icon";
import type { TerminalRoute } from "@/lib/terminalTypes";

export type TerminalNavItem = {
  route: TerminalRoute;
  label: string;
  shortLabel: string;
  href: string;
  icon: IconName;
  group: "Operate" | "Evaluate" | "System";
};

export const terminalNavigation: TerminalNavItem[] = [
  { route: "dashboard", label: "Dashboard", shortLabel: "Home", href: "/", icon: "dashboard", group: "Operate" },
  { route: "market", label: "Market Overview", shortLabel: "Market", href: "/market", icon: "chart", group: "Operate" },
  { route: "strategies", label: "Strategies", shortLabel: "Strategies", href: "/strategies", icon: "strategy", group: "Operate" },
  { route: "positions", label: "Positions", shortLabel: "Positions", href: "/positions", icon: "positions", group: "Operate" },
  { route: "orders", label: "Orders", shortLabel: "Orders", href: "/orders", icon: "orders", group: "Operate" },
  { route: "analytics", label: "Analytics", shortLabel: "Analytics", href: "/analytics", icon: "analytics", group: "Evaluate" },
  { route: "replay", label: "Backtest / Replay", shortLabel: "Replay", href: "/replay", icon: "replay", group: "Evaluate" },
  { route: "risk", label: "Risk Management", shortLabel: "Risk", href: "/risk", icon: "shield", group: "Evaluate" },
  { route: "activity", label: "Alerts & Logs", shortLabel: "Activity", href: "/activity", icon: "bell", group: "System" },
  { route: "settings", label: "Settings", shortLabel: "Settings", href: "/settings", icon: "settings", group: "System" },
];
