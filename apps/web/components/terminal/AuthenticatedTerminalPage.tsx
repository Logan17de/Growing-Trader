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
    return <main className="center-shell"><div className="loading-panel" role="status"><BrandMark large /><div><p className="eyebrow">Growing Trader</p><h1>Opening terminal</h1><p className="muted">Verifying session and loading the latest trading state…</p></div><div className="loading-track" aria-hidden="true"><span /></div></div></main>;
  }

  const mode = status.executionControl?.mode ?? status.paperEngine.mode ?? "paper";
  const armed = Boolean(status.executionControl?.live_armed ?? status.paperEngine.live_armed);
  const modeLabel = mode === "live" ? (armed ? "LIVE · ARMED" : "LIVE · DISARMED") : "PAPER";
  const modeTone = mode === "live" ? (armed ? "bad" : "warn") : "amber";

  return (
    <TerminalShell activeRoute={activeRoute} status={status} onLogout={async () => { await logout(); router.replace("/"); }}>
      <section className="page-hero terminal-page-hero">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>
        <div className="hero-actions">
          <span className={`mode-badge ${mode === "live" ? "live" : ""}`}><span className={`status-dot ${modeTone}`} />{modeLabel}</span>
          <button className="ghost" type="button" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" className={refreshing ? "spin" : ""} />Refresh</button>
        </div>
      </section>
      {mode === "live" && armed && <div className="notice error" role="status"><Icon name="shield" /><div><strong>LIVE broker execution armed</strong><p>Eligible strategy entries and exits can send real Groww F&amp;O orders from Oracle while this mode remains armed.</p></div></div>}
      {error && <div className="notice error" role="alert"><Icon name="shield" /><div><strong>Data refresh failed</strong><p>{error}</p></div></div>}
      {children(status, () => refresh())}
      <footer className="dashboard-footer"><span><span className="status-dot good" />Authenticated control plane</span><span>{mode === "live" ? `LIVE broker execution · ${armed ? "armed" : "disarmed"}` : "Paper execution"}</span></footer>
    </TerminalShell>
  );
}
