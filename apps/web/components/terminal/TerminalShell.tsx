"use client";

import Link from "next/link";
import { DashboardVolumeCard } from "@/components/terminal/DashboardVolumeCard";
import { BrandMark, Icon } from "@/components/terminal/Icon";
import { getEngineHeaderStatus } from "@/lib/engineStatus";
import { terminalNavigation } from "@/lib/navigation";
import type { ControlStatus, TerminalRoute } from "@/lib/terminalTypes";

type Props = {
  activeRoute: TerminalRoute;
  status: ControlStatus | null;
  onLogout: () => void | Promise<void>;
  children: React.ReactNode;
};

export function TerminalShell({ activeRoute, status, onLogout, children }: Props) {
  const groups = ["Operate", "Evaluate", "System"] as const;
  const workerOnline = Boolean(status?.worker.online);
  const engineStatus = getEngineHeaderStatus(status);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <Link className="sidebar-brand" href="/" aria-label="Growing Trader dashboard">
          <BrandMark />
          <div><strong>Growing Trader</strong><span>Operations terminal</span></div>
        </Link>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-group-label">{group}</p>
              {terminalNavigation.filter((item) => item.group === group).map((item) => (
                <Link className={`nav-link${activeRoute === item.route ? " active" : ""}`} href={item.href} key={item.route} aria-current={activeRoute === item.route ? "page" : undefined}>
                  <Icon name={item.icon} /><span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-mode"><span className={`status-dot ${engineStatus.phaseTone}`} />{engineStatus.modeLabel} · {engineStatus.phaseLabel}</span>
          <small>{engineStatus.mode === "live" ? "Groww orders route only through Oracle" : "Simulated fills; no broker orders"}</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="utility-bar">
          <div className="mobile-brand"><BrandMark /><strong>Growing Trader</strong></div>
          <div className="utility-context"><Icon name="terminal" /><span>Operations terminal</span><kbd>{workerOnline ? "SYNC" : "LOCAL"}</kbd></div>
          <div className="top-actions">
            <span className="refresh-note"><Icon name="refresh" />Auto-refresh</span>
            <span className={`engine-header-status ${engineStatus.phase}`} aria-label={`${engineStatus.modeLabel}, engine ${engineStatus.phaseLabel.toLowerCase()}`}>
              <strong>{engineStatus.modeLabel}</strong><i aria-hidden="true" /><span><span className={`status-dot ${engineStatus.phaseTone}`} />{engineStatus.phaseLabel}</span>
            </span>
            <span className={`connection-chip ${workerOnline ? "connected" : "offline"}`}><span className={`status-dot ${workerOnline ? "good" : "bad"}`} />Oracle {workerOnline ? "online" : "offline"}</span>
            <button type="button" className="ghost icon-button" onClick={() => void onLogout()} aria-label="Sign out"><Icon name="logout" /><span>Sign out</span></button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Primary navigation">
          {terminalNavigation.map((item) => (
            <Link className={activeRoute === item.route ? "active" : ""} href={item.href} key={item.route} aria-current={activeRoute === item.route ? "page" : undefined}>{item.shortLabel}</Link>
          ))}
        </nav>
        <main className="workspace-content" id="main-content">{children}{activeRoute==="dashboard"&&<DashboardVolumeCard/>}</main>
      </div>
    </div>
  );
}
