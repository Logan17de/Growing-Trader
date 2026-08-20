"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/terminal/ConfirmDialog";
import { EmptyState } from "@/components/terminal/EmptyState";
import { BrandMark, Icon } from "@/components/terminal/Icon";
import { MarketDecisionCards } from "@/components/terminal/MarketDecisionCards";
import { MetricCard } from "@/components/terminal/MetricCard";
import { PerformanceChart } from "@/components/terminal/PerformanceChart";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { useResearchData } from "@/hooks/useResearchData";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { calculatePaperAnalytics } from "@/lib/terminalAnalytics";
import type { ControlCommand, ControlStatus, TradingDataSnapshot } from "@/lib/terminalTypes";

type Confirmation =
  | { command: "STOP_ENGINE" | "EXIT_PAPER_POSITION" | "KILL_SWITCH" }
  | null;

const ACTIVE_COMMAND_STATES = new Set(["pending", "queued", "claimed", "running", "processing"]);

function normalizeStatus(data: ControlStatus, current?: ControlStatus | null): ControlStatus {
  return {
    ...data,
    recentSignals: data.recentSignals ?? current?.recentSignals ?? [],
    paperOrders: data.paperOrders ?? current?.paperOrders ?? [],
    paperTrades: data.paperTrades ?? current?.paperTrades ?? [],
    paperOutcomes: data.paperOutcomes ?? current?.paperOutcomes ?? [],
  };
}

function relativeHeartbeat(value?: string) {
  if (!value) return "No heartbeat received";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Heartbeat unavailable";
  const ageSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (ageSeconds < 5) return "updated just now";
  if (ageSeconds < 60) return `updated ${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  return `updated ${Math.floor(minutes / 60)}h ago`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function describeRunPaperError(message: string) {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (lower.includes("save groww credentials") || lower.includes("credentials are not configured") || lower.includes("credential file missing")) {
    return "Groww API key/secret is not configured. Add or upload the Groww credential file in Settings, then press Run PAPER again. PAPER engine was not started.";
  }
  if (lower.includes("invalid encrypted credential") || lower.includes("decrypt") || lower.includes("credential format")) {
    return "The saved Groww credential file could not be read securely. Upload the Groww API key/secret again in Settings. PAPER engine was not started.";
  }
  if (
    lower.includes("growwapiauthenticationexception") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid secret")
  ) {
    return "Groww authentication failed. The API key and secret may be invalid or mismatched, or the API-key session may not be approved. Update the Groww credentials in Settings. PAPER engine was not started.";
  }
  if (
    lower.includes("growwapiauthorisationexception") ||
    lower.includes("growwapiauthorizationexception") ||
    lower.includes("authorisation") ||
    lower.includes("authorization") ||
    lower.includes("forbidden")
  ) {
    return "Groww rejected the saved API credentials or permissions. Check the Groww API key, secret, API approval/subscription and account permissions. PAPER engine was not started.";
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("connection") || lower.includes("network")) {
    return "Groww authentication could not complete because the broker connection timed out or was unreachable. PAPER engine was not started.";
  }
  if (lower.includes("oracle worker is offline") || lower.includes("oracle") && lower.includes("offline")) {
    return "Oracle is offline or stale, so Groww authentication cannot be tested. PAPER engine was not started.";
  }
  if (lower.includes("paper engine is already running")) return "PAPER engine is already running.";
  if (lower.includes("stop the live engine")) return "LIVE engine is running. Stop it before Run PAPER can switch execution back to PAPER.";

  return text.startsWith("Groww") || text.startsWith("PAPER")
    ? `${text}${text.endsWith(".") ? "" : "."} PAPER engine was not started.`
    : `Run PAPER failed: ${text || "unknown error"}. PAPER engine was not started.`;
}

export default function SignalDashboard() {
  const [auth, setAuth] = useState<"checking" | "guest" | "ready">("checking");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [pollMs, setPollMs] = useState(3000);
  const { data: researchData } = useResearchData(10_000, auth === "ready");

  const loadTradingData = useCallback(async () => {
    try {
      const data = await jsonRequest<TradingDataSnapshot>("/api/control/trading");
      setStatus((current) => current ? { ...current, ...data } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to load trading history";
      if (message === "unauthorized") setAuth("guest");
      else setNotice((current) => current || `Trading history: ${message}`);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await jsonRequest<ControlStatus>("/api/control/status");
      setStatus((current) => normalizeStatus(data, current));
      setAuth("ready");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to load dashboard status";
      if (message === "unauthorized") setAuth("guest");
      else {
        setNotice(message);
        setAuth("ready");
      }
    }
  }, []);

  useEffect(() => {
    void jsonRequest<{ authenticated: boolean }>("/api/auth/status")
      .then((data) => data.authenticated ? loadStatus() : setAuth("guest"))
      .catch(() => setAuth("guest"));
  }, [loadStatus]);

  useEffect(() => {
    if (auth !== "ready") return;
    void jsonRequest<{ appSettings?: Array<{ key: string; value: unknown }> }>("/api/control/config")
      .then((data) => {
        const parsed = Number(data.appSettings?.find((row) => row.key === "dashboard_refresh_ms")?.value);
        if (Number.isFinite(parsed)) setPollMs(Math.min(Math.max(parsed, 1000), 60000));
      })
      .catch(() => undefined);
  }, [auth]);

  useEffect(() => {
    if (auth !== "ready") return;
    const timer = window.setInterval(() => void loadStatus(), pollMs);
    return () => window.clearInterval(timer);
  }, [auth, loadStatus, pollMs]);

  useEffect(() => {
    if (auth !== "ready") return;
    void loadTradingData();
    const timer = window.setInterval(() => void loadTradingData(), 15000);
    return () => window.clearInterval(timer);
  }, [auth, loadTradingData]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy("login");
    setNotice("");
    try {
      await jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      await loadStatus();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Login failed");
    } finally {
      setBusy("");
    }
  }

  async function command(commandName: ControlCommand, payload: Record<string, unknown> = {}) {
    setBusy(commandName);
    setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandName, payload }),
      });
      setNotice(result.duplicate ? `${commandName.replaceAll("_", " ")} is already queued or running.` : `${commandName.replaceAll("_", " ")} queued for Oracle.`);
      await loadStatus();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Command failed");
    } finally {
      setBusy("");
      setConfirmation(null);
    }
  }

  async function runPaper() {
    setBusy("RUN_PAPER");
    setNotice("Checking Groww authentication…");
    try {
      const queued = await jsonRequest<{ id: string; duplicate?: boolean }>("/api/control/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "RUN_PAPER", payload: {} }),
      });

      const deadline = Date.now() + 45_000;
      let commandCompleted = false;
      let authenticationConfirmed = false;

      while (Date.now() < deadline) {
        await delay(750);
        const current = await jsonRequest<ControlStatus>("/api/control/status");
        setStatus((previous) => normalizeStatus(current, previous));
        setAuth("ready");

        const tracked = current.latestCommand;
        if (!tracked || tracked.id !== queued.id) continue;
        const state = (tracked.status ?? "").toLowerCase();

        if (state === "failed" || state === "error") {
          throw new Error(tracked.error ?? "Groww authentication failed");
        }

        if (state === "completed") {
          commandCompleted = true;
          const result = tracked.result ?? {};
          const authentication = result.authentication;
          authenticationConfirmed = Boolean(
            current.worker.groww_authenticated ||
            (authentication && typeof authentication === "object" && (authentication as Record<string, unknown>).ok === true),
          );
          if (!authenticationConfirmed) {
            throw new Error("Groww authentication did not verify the saved API key/secret");
          }

          const paperMode = (current.executionControl?.mode ?? current.paperEngine.mode ?? "paper") === "paper";
          if (current.paperEngine.running && paperMode) {
            setNotice("Groww authenticated successfully. PAPER engine is active.");
            return;
          }
          setNotice("Groww authenticated successfully. Starting PAPER engine…");
        } else if (ACTIVE_COMMAND_STATES.has(state)) {
          setNotice("Checking Groww authentication…");
        }
      }

      if (commandCompleted && authenticationConfirmed) {
        throw new Error("Groww authenticated, but PAPER engine did not become active");
      }
      throw new Error("Groww authentication timed out before Oracle returned a result");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Run PAPER failed";
      setNotice(describeRunPaperError(message));
      await loadStatus();
    } finally {
      setBusy("");
      setConfirmation(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatus(null);
    setAuth("guest");
  }

  if (auth === "checking") return <main className="center-shell"><div className="loading-panel" role="status" aria-live="polite"><BrandMark large /><div><p className="eyebrow">Growing Trader</p><h1>Opening your terminal</h1><p className="muted">Checking the secure dashboard session…</p></div><div className="loading-track" aria-hidden="true"><span /></div></div></main>;

  if (auth === "guest") return <main className="center-shell"><section className="login-shell"><div className="login-context"><div className="brand-lockup"><BrandMark /><span>Growing Trader</span></div><div className="login-copy"><p className="eyebrow">Private operations workspace</p><h1>Read the market.<br /><span>Control the risk.</span></h1><p>A secure terminal for NIFTY research with paper-first execution and explicitly armed LIVE trading.</p></div><div className="login-network" aria-label="System architecture"><span><Icon name="layers" />Vercel</span><i /><span><Icon name="database" />Supabase</span><i /><span><Icon name="server" />Oracle</span></div><p className="paper-note"><span className="status-dot amber" /> PAPER is the default</p></div><form className="login-card" onSubmit={login}><div className="login-card-icon"><Icon name="lock" /></div><p className="eyebrow">Secure access</p><h2>Welcome back</h2><p className="muted">Enter your dashboard password to continue.</p><label className="field login-field"><span>Dashboard password</span><div className="input-wrap"><Icon name="key" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required autoFocus /></div></label><button className="primary button-wide" disabled={busy === "login"}>{busy === "login" ? <><Icon name="refresh" className="spin" />Signing in…</> : <>Open terminal<Icon name="arrow-right" /></>}</button>{notice && <p className="notice error" role="alert">{notice}</p>}<div className="security-note"><Icon name="shield" /><span>Credentials stay encrypted and are never returned to this browser.</span></div></form></section></main>;

  const worker = status?.worker ?? {};
  const engine = status?.paperEngine ?? { running: false, state: "stopped" };
  const mode = status?.executionControl?.mode ?? engine.mode ?? "paper";
  const liveArmed = Boolean(status?.executionControl?.live_armed ?? engine.live_armed);
  const activePosition = engine.open_position ?? engine.open_paper_position;
  const modeOrders = (status?.paperOrders ?? []).filter((order) => order.mode === mode);
  const modeTrades = (status?.paperTrades ?? []).filter((trade) => (trade.mode ?? "paper") === mode);
  const analytics = calculatePaperAnalytics(modeTrades, modeOrders);
  const backendErrors = status?.controlPlane.errors ?? {};
  const currentExposure = engine.current_exposure ?? (activePosition?.entry_price && activePosition.quantity ? activePosition.entry_price * activePosition.quantity : null);
  const oracleState = worker.state === "stopped" ? "STOPPED" : worker.online ? "ONLINE" : worker.stale ? "STALE" : "OFFLINE";
  const oracleTone = worker.online ? "good" : worker.stale ? "warn" : "bad";
  const engineTone = engine.state === "error" ? "bad" : engine.running ? "good" : "warn";
  const hasPosition = Boolean(activePosition);
  const killActive = Boolean(engine.kill_switch);
  const modeLabel = mode === "live" ? (liveArmed ? "LIVE · ARMED" : "LIVE · DISARMED") : "PAPER";
  const latestCommandStatus = (status?.latestCommand?.status ?? "").toLowerCase();
  const runPaperCurrent = status?.latestCommand?.command === "RUN_PAPER";
  const runPaperActive = Boolean(runPaperCurrent && ACTIVE_COMMAND_STATES.has(latestCommandStatus));
  const canRunPaper = Boolean(worker.online && !engine.running && !busy && !runPaperActive);
  const canStopEngine = Boolean(worker.online && engine.running && !busy);
  const growwTone = worker.groww_authenticated ? "good" : status?.credentials.configured ? "warn" : "bad";
  const growwLabel = worker.groww_authenticated ? "VERIFIED" : status?.credentials.configured ? "NOT VERIFIED" : "SETUP REQUIRED";
  const runPaperDetail = !worker.online
    ? "Oracle must be online before a run can start."
    : !status?.credentials.configured
      ? "Press Run PAPER to check setup; if the Groww API key/secret is missing, the dashboard will tell you and keep the engine stopped."
      : engine.running
        ? `${modeLabel} engine is already running.`
        : "Run PAPER verifies Groww first. Only a successful authentication switches to PAPER, disarms LIVE and activates the engine.";
  const noticeIsError = /required|failed|could not|offline|unauthorized|error|invalid|mismatch|rejected|not configured|timed out|stop the live/i.test(notice);

  const confirmationCopy = confirmation?.command === "EXIT_PAPER_POSITION"
    ? {
        title: `Close the open ${mode.toUpperCase()} position?`,
        description: mode === "live" ? "Oracle will submit a real Groww market SELL for the current LIVE option quantity." : "Oracle will close the current paper position at the next observed option-chain LTP.",
        label: mode === "live" ? "SELL / close LIVE position" : "Close paper position",
        busy: busy === "EXIT_PAPER_POSITION",
      }
    : confirmation?.command === "KILL_SWITCH"
      ? {
          title: `Activate the ${mode.toUpperCase()} kill switch?`,
          description: mode === "live" ? "New entries are blocked and Oracle will attempt a real Groww SELL for the open LIVE position when close-on-kill is enabled." : "New entries are blocked and Oracle will close the open paper position at the next observable option mark.",
          label: "Activate kill switch",
          busy: busy === "KILL_SWITCH",
        }
      : {
          title: `Pause the ${mode.toUpperCase()} engine?`,
          description: mode === "live" ? "This stops strategy processing. If a LIVE position is open, close it or use the kill switch before stopping app-managed protection." : "This stops paper strategy processing through Oracle until you run it again.",
          label: `Pause ${mode} engine`,
          busy: busy === "STOP_ENGINE",
        };

  return <TerminalShell activeRoute="dashboard" status={status} onLogout={logout}>
    <section className="page-hero terminal-page-hero">
      <div>
        <p className="eyebrow">Command center · {modeLabel}</p>
        <h1>Trading dashboard</h1>
        <p className="muted">Start PAPER safely, monitor the market and positions, and react when risk needs attention.</p>
      </div>
      <div className="hero-actions">
        <button className="primary" type="button" disabled={!canRunPaper} onClick={() => void runPaper()}>
          {(busy === "RUN_PAPER" || runPaperActive) ? <Icon name="refresh" className="spin" /> : <Icon name="activity" />}
          {busy === "RUN_PAPER" ? "Checking Groww…" : runPaperActive ? "Starting PAPER…" : "Run PAPER"}
        </button>
        {engine.running && <button className="secondary" type="button" disabled={!canStopEngine} onClick={() => setConfirmation({ command: "STOP_ENGINE" })}><Icon name="stop" />Pause</button>}
        <Link className="ghost" href="/settings"><Icon name="settings" />Settings</Link>
      </div>
    </section>

    <section className="command-bar terminal-section" aria-label="Paper run readiness">
      <div><p className="eyebrow">One-click PAPER run</p><h2>{engine.running ? `${modeLabel} engine active` : "Ready when broker access is ready"}</h2><p>{runPaperDetail}</p></div>
      <div className="command-actions">
        {hasPosition && <button className="danger" type="button" disabled={!worker.online || Boolean(busy)} onClick={() => setConfirmation({ command: "EXIT_PAPER_POSITION" })}>{mode === "live" ? "Close LIVE position" : "Close position"}</button>}
        {killActive
          ? <button className="secondary" type="button" disabled={!worker.online || Boolean(busy)} onClick={() => void command("RESET_KILL_SWITCH")}><Icon name="shield" />Reset kill switch</button>
          : <button className="kill-switch compact" type="button" disabled={!worker.online || Boolean(busy)} onClick={() => setConfirmation({ command: "KILL_SWITCH" })}><Icon name="shield" /><span><strong>KILL SWITCH</strong><small>Block + close position</small></span></button>}
      </div>
    </section>

    {mode === "live" && liveArmed && <div className="notice error" role="status"><Icon name="shield" /><div><strong>LIVE broker execution armed</strong><p>Eligible entries and exits can place real Groww F&amp;O orders from Oracle. Running PAPER will disarm LIVE first.</p></div></div>}
    {notice && <div className={`notice${noticeIsError ? " error" : ""}`} role={noticeIsError ? "alert" : "status"} aria-live="polite"><Icon name={noticeIsError ? "shield" : "activity"} /><span>{notice}</span></div>}
    {Object.keys(backendErrors).length > 0 && <div className="notice error" role="alert"><Icon name="shield" /><div><strong>Control plane degraded</strong><p>{Object.values(backendErrors).join(" · ")}</p></div></div>}

    <section className="terminal-metric-grid five dashboard-kpis" aria-label="Trading performance metrics">
      <MetricCard label="Today's P&L" value={formatCurrency(analytics.todayPnl)} detail={`${analytics.tradesToday} ${mode} orders today`} tone={(analytics.todayPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.todayPnl === null} />
      <MetricCard label="Unrealized P&L" value={formatCurrency(activePosition?.unrealized_pnl)} unavailable={activePosition?.unrealized_pnl == null} tone={(activePosition?.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
      <MetricCard label="Available capital" value={formatCurrency(engine.available_capital)} unavailable={engine.available_capital == null} />
      <MetricCard label="Current exposure" value={formatCurrency(currentExposure)} detail={`${mode.toUpperCase()} premium`} icon="shield" unavailable={currentExposure === null} />
      <MetricCard label="Trades today" value={String(analytics.tradesToday)} detail={`Persisted ${mode} orders`} icon="orders" />
      <MetricCard label="Win rate" value={formatPercent(analytics.winRate)} unavailable={analytics.winRate === null} />
    </section>

    <MarketDecisionCards status={status} points={researchData?.niftyVolumeSeries ?? []} />

    <section className="dashboard-grid terminal-section">
      <article className="card span-7"><PerformanceChart trades={modeTrades} /></article>
      <article className="card span-5">
        <div className="section-heading compact"><div><p className="eyebrow">System status</p><h2>Run readiness</h2></div></div>
        <div className="runtime-list">
          <div><span className={`status-icon ${oracleTone}`}><Icon name="server" /></span><div><strong>Oracle agent</strong><small>{worker.online ? `Active · ${relativeHeartbeat(worker.last_heartbeat)}` : relativeHeartbeat(worker.last_heartbeat)}</small></div><span className={`status-badge ${oracleTone}`}><span className={`status-dot ${oracleTone}`} />{oracleState}</span></div>
          <div><span className={`status-icon ${growwTone}`}><Icon name="shield" /></span><div><strong>Groww broker</strong><small>{status?.credentials.configured ? (worker.groww_authenticated ? "Authentication verified" : "Credentials saved; Run PAPER will verify them") : "Credential file missing"}</small>{!status?.credentials.configured && <Link className="inline-link" href="/settings">Open settings <Icon name="arrow-right" /></Link>}</div><span className={`status-badge ${growwTone}`}>{growwLabel}</span></div>
          <div><span className={`status-icon ${engineTone}`}><Icon name="strategy" /></span><div><strong>Trading engine</strong><small>{engine.feed_connected ? "Market feed connected" : "Market feed waiting"}</small></div><span className={`status-badge ${engineTone}`}>{engine.running ? modeLabel : (engine.state ?? "Stopped").replaceAll("_", " ")}</span></div>
          <div><span className={`status-icon ${killActive ? "bad" : "good"}`}><Icon name="shield" /></span><div><strong>Risk gate</strong><small>{killActive ? "New entries blocked" : "Normal risk policy"}</small>{killActive && <Link className="inline-link" href="/risk">Open risk controls <Icon name="arrow-right" /></Link>}</div><span className={`status-badge ${killActive ? "bad" : "good"}`}>{killActive ? "KILL" : "CLEAR"}</span></div>
        </div>
      </article>
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-7">
        <div className="section-heading compact"><div><p className="eyebrow">Open inventory</p><h2>Current position</h2></div><Link href="/positions" className="inline-link">All positions <Icon name="arrow-right" /></Link></div>
        {!activePosition
          ? <EmptyState icon="positions" title={`No open ${mode.toUpperCase()} position`} description="The current managed position appears here after an entry passes strategy and risk checks." />
          : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Qty</th><th>Entry</th><th>LTP</th><th>Unrealized P&amp;L</th><th>Opened</th></tr></thead><tbody><tr><td><strong>{activePosition.trading_symbol}</strong></td><td className="numeric">{formatNumber(activePosition.quantity, 0)}</td><td className="numeric">{formatNumber(activePosition.entry_price)}</td><td className="numeric">{formatNumber(activePosition.current_price)}</td><td className={`numeric ${(activePosition.unrealized_pnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(activePosition.unrealized_pnl)}</td><td>{formatDateTime(activePosition.opened_at)}</td></tr></tbody></table></div>}
      </article>
      <article className="card span-5">
        <div className="section-heading compact"><div><p className="eyebrow">Recent orders</p><h2>{mode.toUpperCase()} lifecycle</h2></div><Link href="/orders" className="inline-link">All orders <Icon name="arrow-right" /></Link></div>
        {!modeOrders.length
          ? <EmptyState compact icon="orders" title={`No ${mode} orders`} description="No order records are persisted yet for this execution mode." />
          : <div className="compact-order-list">{modeOrders.slice(0, 5).map((order) => <div key={order.id}><span className={`side-badge ${order.side.toLowerCase()}`}>{order.side}</span><div><strong>{order.trading_symbol}</strong><small>{formatDateTime(order.created_at)}</small></div><div><strong>{formatNumber(order.quantity, 0)}</strong><small>{order.status}</small></div></div>)}</div>}
      </article>
    </section>

    <footer className="dashboard-footer"><span><span className={`status-dot ${status?.controlPlane.healthy ? "good" : "bad"}`} />Control plane {status?.controlPlane.healthy ? "healthy" : "degraded"}</span><span>{modeLabel} · Refresh {Math.round(pollMs / 1000)}s</span></footer>

    <ConfirmDialog
      open={confirmation !== null}
      title={confirmationCopy.title}
      description={confirmationCopy.description}
      confirmLabel={confirmationCopy.label}
      busy={confirmationCopy.busy}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        if (confirmation?.command === "EXIT_PAPER_POSITION") void command("EXIT_PAPER_POSITION", { fraction: 1 });
        else if (confirmation?.command === "KILL_SWITCH") void command("KILL_SWITCH", { close_position: true, reason: "Activated from dashboard" });
        else if (confirmation) void command(confirmation.command);
      }}
    />
  </TerminalShell>;
}
