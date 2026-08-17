export type IconName =
  | "activity" | "analytics" | "arrow-right" | "bell" | "chart" | "check"
  | "clock" | "dashboard" | "database" | "download" | "key" | "layers" | "lock" | "logout"
  | "minus" | "orders" | "plus" | "positions" | "refresh" | "replay" | "server"
  | "settings" | "shield" | "stop" | "strategy" | "terminal" | "trash" | "wifi" | "x";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  let paths: React.ReactNode;
  switch (name) {
    case "activity": paths = <><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>; break;
    case "analytics": paths = <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>; break;
    case "arrow-right": paths = <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>; break;
    case "bell": paths = <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>; break;
    case "chart": paths = <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>; break;
    case "check": paths = <path d="m5 12 4 4L19 6" />; break;
    case "clock": paths = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>; break;
    case "dashboard": paths = <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>; break;
    case "database": paths = <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>; break;
    case "download": paths = <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>; break;
    case "key": paths = <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M15 8l2 2M17 6l2 2" /></>; break;
    case "layers": paths = <><path d="m12 3-9 5 9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>; break;
    case "lock": paths = <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>; break;
    case "logout": paths = <><path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></>; break;
    case "minus": paths = <path d="M5 12h14" />; break;
    case "orders": paths = <><path d="M7 3h10l2 3v15H5V6l2-3Z" /><path d="M8 10h8M8 14h8M8 18h5" /></>; break;
    case "plus": paths = <><path d="M12 5v14M5 12h14" /></>; break;
    case "positions": paths = <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8 10h6.5a2.5 2.5 0 0 1 0 5H8" /></>; break;
    case "refresh": paths = <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>; break;
    case "replay": paths = <><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v6h6" /><path d="m10 9 5 3-5 3Z" /></>; break;
    case "server": paths = <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>; break;
    case "settings": paths = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>; break;
    case "shield": paths = <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>; break;
    case "stop": paths = <><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" /></>; break;
    case "strategy": paths = <><path d="M4 5h6v6H4zM14 13h6v6h-6z" /><path d="M10 8h3a4 4 0 0 1 4 4v1M14 16h-3a4 4 0 0 1-4-4v-1" /></>; break;
    case "terminal": paths = <><path d="m4 7 4 4-4 4M11 17h9" /></>; break;
    case "trash": paths = <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>; break;
    case "wifi": paths = <><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01" /></>; break;
    case "x": paths = <><path d="m6 6 12 12M18 6 6 18" /></>; break;
  }
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

export function BrandMark({ large = false }: { large?: boolean }) {
  return <div className={`brand-mark${large ? " brand-mark-large" : ""}`} aria-hidden="true"><Icon name="activity" /></div>;
}
