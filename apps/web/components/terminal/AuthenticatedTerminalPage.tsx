"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, Icon } from "@/components/terminal/Icon";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { useTerminalStatus } from "@/hooks/useTerminalStatus";
import type { ControlStatus, TerminalRoute } from "@/lib/terminalTypes";

type Props = {
  activeRoute: TerminalRoute;
  eyebrow: string;
  title: string;
  description: string;
  children: (status: ControlStatus, refresh: () => Promise<void>) => React.ReactNode;
};

export function AuthenticatedTerminalPage({ activeRoute, eyebrow, title, description, children }: Props) {
  const router = useRouter();
  const { auth, status, error, refreshing, refresh, logout } = useTerminalStatus();

  useEffect(() => {
    if (auth === "guest") router.replace("/");
  }, [auth, router]);

  if (auth !== "ready" || !status) {
    return <main className="center-shell"><div className="loading-panel" role="status"><BrandMark large /><div><p className="eyebrow">Growing Trader</p><h1>Opening terminal</h1><p className="muted">Verifying session and loading the latest paper state…</p></div><div className="loading-track" aria-hidden="true"><span /></div></div></main>;
  }

  return (
    <TerminalShell activeRoute={activeRoute} status={status} onLogout={async () => { await logout(); router.replace("/"); }}>
      <section className="page-hero terminal-page-hero">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>
        <div className="hero-actions">
          <span className="mode-badge"><span className="status-dot amber" />Paper mode</span>
          <button className="ghost" type="button" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" className={refreshing ? "spin" : ""} />Refresh</button>
        </div>
      </section>
      {error && <div className="notice error" role="alert"><Icon name="shield" /><div><strong>Data refresh failed</strong><p>{error}</p></div></div>}
      {children(status, () => refresh())}
      <footer className="dashboard-footer"><span><span className="status-dot good" />Authenticated control plane</span><span>Paper execution · No live broker orders</span></footer>
    </TerminalShell>
  );
}
