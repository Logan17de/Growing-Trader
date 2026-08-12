"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { SignalPayload } from "@/lib/types";

type WorkerStatus = {
  online?: boolean;
  stale?: boolean;
  state?: string;
  execution_mode?: string;
  last_heartbeat?: string;
  groww_authenticated?: boolean;
  market_data_status?: string;
  market_data?: Record<string, unknown> | null;
  last_error?: string | null;
};

type PaperEngineStatus = {
  running?: boolean;
  state?: string;
  feed_connected?: boolean;
  started_at?: string;
  updated_at?: string;
  statusUpdatedAt?: string;
  universe_as_of?: string;
  weighting?: string;
  constituents_total?: number;
  constituents_resolved?: number;
  constituents_fresh?: number;
  quote_successes?: number;
  quote_errors?: string[];
  future_symbol?: string;
  future_ltp?: number | null;
  nifty_ltp?: number | null;
  option_expiry?: string;
  option_contract_count?: number;
  last_quote_scan?: string;
  last_option_refresh?: string;
  data_age_seconds?: number;
  last_error?: string | null;
  last_signal?: {
    event?: string;
    direction?: string;
    confidence?: number;
    risk_allowed?: boolean;
    paper_entry?: boolean;
    reason?: string;
  } | null;
  open_paper_position?: {
    trading_symbol?: string;
    quantity?: number;
    entry_price?: number;
    opened_at?: string;
    marks_recorded?: number[];
  } | null;
};

type CommandStatus = {
  id: string;
  command: string;
  status: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

type Level = {
  id: string;
  name: string;
  kind: string;
  price: number;
  source: string;
  enabled: boolean;
};

type ControlStatus = {
  controlPlane: { healthy: boolean; errors: Record<string, string> };
  worker: WorkerStatus;
  paperEngine: PaperEngineStatus;
  latestCommand: CommandStatus | null;
  credentials: { configured: boolean; updatedAt: string | null };
  latestSignal: { payload: SignalPayload; observed_at: string } | null;
  levels: Level[];
};

type ControlCommand =
  | "TEST_AUTH"
  | "TEST_MARKET_DATA"
  | "START_PAPER_ENGINE"
  | "STOP_PAPER_ENGINE"
  | "STOP";

function pct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

type IconName =
  | "activity"
  | "arrow-right"
  | "chart"
  | "database"
  | "key"
  | "layers"
  | "lock"
  | "logout"
  | "plus"
  | "refresh"
  | "server"
  | "shield"
  | "stop"
  | "terminal"
  | "trash"
  | "wifi";

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  let paths;

  switch (name) {
    case "activity":
      paths = <><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>;
      break;
    case "arrow-right":
      paths = <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>;
      break;
    case "chart":
      paths = <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>;
      break;
    case "database":
      paths = <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>;
      break;
    case "key":
      paths = <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8" /><path d="m15 8 2 2" /><path d="m17 6 2 2" /></>;
      break;
    case "layers":
      paths = <><path d="m12 3-9 5 9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>;
      break;
    case "lock":
      paths = <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
      break;
    case "logout":
      paths = <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></>;
      break;
    case "plus":
      paths = <><path d="M12 5v14" /><path d="M5 12h14" /></>;
      break;
    case "refresh":
      paths = <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>;
      break;
    case "server":
      paths = <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>;
      break;
    case "shield":
      paths = <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>;
      break;
    case "stop":
      paths = <><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" /></>;
      break;
    case "terminal":
      paths = <><path d="m4 7 4 4-4 4" /><path d="M11 17h9" /></>;
      break;
    case "trash":
      paths = <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="m6 7 1 14h10l1-14" /><path d="M9 7V4h6v3" /></>;
      break;
    case "wifi":
      paths = <><path d="M5 12.6a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M12 20h.01" /></>;
      break;
  }

  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}

function fmtTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function fmtNumber(value?: number | null, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export default function SignalDashboard() {
  const [auth, setAuth] = useState<"checking" | "guest" | "ready">("checking");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [levelName, setLevelName] = useState("");
  const [levelKind, setLevelKind] = useState<"support" | "resistance">("support");
  const [levelPrice, setLevelPrice] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const data = await jsonRequest<ControlStatus>("/api/control/status");
      setStatus(data);
      setNotice((current) => {
        const latest = data.latestCommand;
        if (!latest || (latest.status !== "completed" && latest.status !== "failed")) return current;
        const isQueueNotice =
          current.startsWith(`${latest.command} queued`) ||
          current.startsWith(`${latest.command} is already`);
        return isQueueNotice ? "" : current;
      });
      setAuth("ready");
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        setAuth("guest");
      } else {
        setNotice(error instanceof Error ? error.message : "Failed to load dashboard status");
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
    const timer = window.setInterval(() => void loadStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [auth, loadStatus]);

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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy("");
    }
  }

  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy("credentials");
    setNotice("");
    try {
      await jsonRequest("/api/control/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      setApiKey("");
      setApiSecret("");
      setNotice("Groww credentials encrypted and saved. Re-run authentication before trusting broker status.");
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save credentials");
    } finally {
      setBusy("");
    }
  }

  async function saveLevel(event: FormEvent) {
    event.preventDefault();
    setBusy("level");
    setNotice("");
    try {
      await jsonRequest("/api/control/levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: levelName, kind: levelKind, price: Number(levelPrice) }),
      });
      setLevelName("");
      setLevelPrice("");
      setNotice("Support/resistance level saved.");
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save level");
    } finally {
      setBusy("");
    }
  }

  async function removeLevel(id: string) {
    setBusy(`delete-${id}`);
    setNotice("");
    try {
      await jsonRequest("/api/control/levels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove level");
    } finally {
      setBusy("");
    }
  }

  async function command(commandName: ControlCommand) {
    setBusy(commandName);
    setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandName }),
      });
      setNotice(
        result.duplicate
          ? `${commandName} is already queued/running.`
          : `${commandName} queued for Oracle.`,
      );
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Command failed");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatus(null);
    setAuth("guest");
  }

  if (auth === "checking") {
    return (
      <main className="center-shell">
        <div className="loading-panel" role="status" aria-live="polite">
          <div className="brand-mark brand-mark-large" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <p className="eyebrow">Growing Trader</p>
            <h1>Opening your control plane</h1>
            <p className="muted">Checking the secure dashboard session…</p>
          </div>
          <div className="loading-track" aria-hidden="true"><span /></div>
        </div>
      </main>
    );
  }

  if (auth === "guest") {
    return (
      <main className="center-shell">
        <section className="login-shell">
          <div className="login-context">
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
              <span>Growing Trader</span>
            </div>
            <div className="login-copy">
              <p className="eyebrow">Private operations workspace</p>
              <h1>Trade the signal.<br /><span>Control the risk.</span></h1>
              <p>One secure view across your market engine, broker connectivity, and paper-trading controls.</p>
            </div>
            <div className="login-network" aria-label="System architecture">
              <span><Icon name="layers" />Vercel</span>
              <i />
              <span><Icon name="database" />Supabase</span>
              <i />
              <span><Icon name="server" />Oracle</span>
            </div>
            <p className="paper-note"><span className="status-dot amber" /> Paper execution only</p>
          </div>

          <form className="login-card" onSubmit={login}>
            <div className="login-card-icon"><Icon name="lock" /></div>
            <p className="eyebrow">Secure access</p>
            <h2>Welcome back</h2>
            <p className="muted">Enter your dashboard password to continue.</p>
            <label className="field login-field">
              <span>Dashboard password</span>
              <div className="input-wrap"><Icon name="key" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Enter your password" required autoFocus /></div>
            </label>
            <button className="primary button-wide" disabled={busy === "login"}>
              {busy === "login" ? <><Icon name="refresh" className="spin" />Signing in…</> : <>Open dashboard<Icon name="arrow-right" /></>}
            </button>
            {notice && <p className="notice error" role="alert">{notice}</p>}
            <div className="security-note"><Icon name="shield" /><span>Your credentials stay encrypted and are never returned to this browser.</span></div>
          </form>
        </section>
      </main>
    );
  }

  const worker = status?.worker ?? {};
  const paper = status?.paperEngine ?? { running: false, state: "stopped" };
  const signal = status?.latestSignal?.payload ?? null;
  const marketData = worker.market_data ?? null;
  const backendErrors = status?.controlPlane?.errors ?? {};
  const oracleState = worker.state === "stopped"
    ? "STOPPED"
    : worker.online
      ? "ONLINE"
      : worker.stale
        ? "STALE"
        : "OFFLINE";
  const oracleClass = worker.online ? "good" : worker.stale ? "warn" : "bad";
  const paperState = (paper.state ?? "stopped").toUpperCase();
  const paperClass = paper.state === "error" ? "bad" : paper.running ? "good" : "warn";
  const canBrokerTest = Boolean(worker.online && status?.credentials.configured && !busy);
  const canStartPaper = Boolean(worker.online && status?.credentials.configured && !paper.running && !busy);
  const canStopPaper = Boolean(worker.online && paper.running && !busy);
  const canStop = Boolean(worker.online && !busy);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="header-main">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
            <span>Growing Trader</span>
          </div>
          <div className="header-title">
            <p className="eyebrow">Operations dashboard</p>
            <h1>Market control</h1>
            <p className="muted">Monitor the engine, verify the broker, and manage paper-trading levels.</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="refresh-note"><Icon name="refresh" />Auto-refresh · 3s</span>
          <span className="pill paper"><span className="status-dot amber" />Paper only</span>
          <button type="button" className="ghost icon-button" onClick={logout}><Icon name="logout" /><span>Sign out</span></button>
        </div>
      </header>

      {notice && <div className="notice" role="status" aria-live="polite"><Icon name="activity" /><span>{notice}</span></div>}
      {Object.keys(backendErrors).length > 0 && (
        <div className="notice error" role="alert">
          <Icon name="shield" />
          <div><strong>Control plane degraded.</strong><pre className="error-box">{JSON.stringify(backendErrors, null, 2)}</pre></div>
        </div>
      )}

      <section className="status-strip" aria-label="System status">
        <article className="status-card">
          <div className="status-icon"><Icon name="server" /></div>
          <div className="status-content"><span className="label">Oracle agent</span><strong className={oracleClass}><span className={`status-dot ${oracleClass}`} />{oracleState}</strong><small>Heartbeat · {fmtTime(worker.last_heartbeat)}</small></div>
        </article>
        <article className="status-card">
          <div className="status-icon"><Icon name="shield" /></div>
          <div className="status-content"><span className="label">Groww auth</span><strong className={worker.groww_authenticated ? "good" : "warn"}><span className={`status-dot ${worker.groww_authenticated ? "good" : "warn"}`} />{worker.groww_authenticated ? "READY" : "NOT VERIFIED"}</strong><small>Agent state · {worker.state ?? "idle"}</small></div>
        </article>
        <article className="status-card">
          <div className="status-icon"><Icon name="wifi" /></div>
          <div className="status-content"><span className="label">Market data</span><strong className={worker.market_data_status === "ok" ? "good" : worker.market_data_status === "error" ? "bad" : "warn"}><span className={`status-dot ${worker.market_data_status === "ok" ? "good" : worker.market_data_status === "error" ? "bad" : "warn"}`} />{(worker.market_data_status ?? "unknown").toUpperCase()}</strong><small>Oracle → Groww</small></div>
        </article>
        <article className="status-card">
          <div className="status-icon"><Icon name="activity" /></div>
          <div className="status-content"><span className="label">Paper engine</span><strong className={paperClass}><span className={`status-dot ${paperClass}`} />{paperState}</strong><small>{paper.feed_connected ? "Feed connected" : "Feed disconnected"}</small></div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="card span-8">
          <div className="card-head"><div className="title-with-icon"><div className="card-icon"><Icon name="key" /></div><div><span className="label">Broker connection</span><h2>Groww credentials</h2></div></div><span className="secure-badge"><Icon name="lock" />Server-side encrypted</span></div>
          <p className="muted">Saving a new key/secret invalidates the previous Groww verification state. The credentials are never returned to the browser.</p>
          <form className="credential-form" onSubmit={saveCredentials}>
            <label className="field"><span>API key</span><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="Enter API key" required /></label>
            <label className="field"><span>API secret</span><input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" placeholder="Enter API secret" required /></label>
            <button className="primary" disabled={busy === "credentials"}>{busy === "credentials" ? <><Icon name="refresh" className="spin" />Encrypting…</> : <><Icon name="lock" />Save credentials</>}</button>
          </form>
        </article>

        <article className="card span-4">
          <div className="title-with-icon"><div className="card-icon"><Icon name="activity" /></div><div><span className="label">Oracle commands</span><h2>Connectivity tests</h2></div></div>
          {!worker.online && <p className="muted">Start the Oracle control agent before running commands.</p>}
          {worker.online && !status?.credentials.configured && <p className="muted">Save Groww credentials before running broker tests.</p>}
          <div className="button-stack">
            <button type="button" className="primary" onClick={() => command("TEST_AUTH")} disabled={!canBrokerTest}>{busy === "TEST_AUTH" ? <Icon name="refresh" className="spin" /> : <Icon name="shield" />}Test Groww authentication</button>
            <button type="button" className="secondary" onClick={() => command("TEST_MARKET_DATA")} disabled={!canBrokerTest}>{busy === "TEST_MARKET_DATA" ? <Icon name="refresh" className="spin" /> : <Icon name="chart" />}Test Groww market data</button>
            <button type="button" className="danger" onClick={() => command("STOP")} disabled={!canStop}>{busy === "STOP" ? <Icon name="refresh" className="spin" /> : <Icon name="stop" />}Stop Oracle agent</button>
          </div>
        </article>

        <article className="card span-4">
          <div className="title-with-icon"><div className="card-icon"><Icon name="activity" /></div><div><span className="label">Paper engine controls</span><h2>Live research runner</h2></div></div>
          <p className="muted">Streams LTP, scans quotes/OI, refreshes the option chain and writes paper signals. It cannot place a real Groww order.</p>
          <div className="button-stack">
            <button type="button" className="primary" onClick={() => command("START_PAPER_ENGINE")} disabled={!canStartPaper}>{busy === "START_PAPER_ENGINE" ? <Icon name="refresh" className="spin" /> : <Icon name="activity" />}Start paper engine</button>
            <button type="button" className="secondary" onClick={() => command("STOP_PAPER_ENGINE")} disabled={!canStopPaper}>{busy === "STOP_PAPER_ENGINE" ? <Icon name="refresh" className="spin" /> : <Icon name="stop" />}Stop paper engine</button>
          </div>
        </article>

        <article className="card span-8">
          <div className="card-head"><div className="title-with-icon"><div className="card-icon"><Icon name="chart" /></div><div><span className="label">Live paper engine</span><h2>{paperState}</h2></div></div><span className="pill"><span className={`status-dot ${paperClass}`} />{paper.weighting ? `${paper.weighting} weights` : "paper"}</span></div>
          <div className="metric-grid">
            <div><span>Feed</span><strong className={paper.feed_connected ? "good" : "warn"}>{paper.feed_connected ? "CONNECTED" : "WAITING"}</strong></div>
            <div><span>Constituents</span><strong>{paper.constituents_fresh ?? 0} / {paper.constituents_total ?? 50}</strong></div>
            <div><span>NIFTY</span><strong>{fmtNumber(paper.nifty_ltp)}</strong></div>
            <div><span>Data age</span><strong>{typeof paper.data_age_seconds === "number" ? `${paper.data_age_seconds.toFixed(1)}s` : "—"}</strong></div>
            <div><span>Future</span><strong>{paper.future_symbol ?? "—"}</strong><small>{fmtNumber(paper.future_ltp)}</small></div>
            <div><span>Option expiry</span><strong>{paper.option_expiry ?? "—"}</strong><small>{paper.option_contract_count ?? 0} contracts</small></div>
            <div><span>Quote scan</span><strong>{paper.quote_successes ?? 0} / {paper.constituents_resolved ?? 0}</strong><small>{fmtTime(paper.last_quote_scan)}</small></div>
            <div><span>Option refresh</span><strong>{fmtTime(paper.last_option_refresh)}</strong></div>
          </div>
          {paper.last_signal && <p className="muted">Last engine state: {(paper.last_signal.event ?? "—").toUpperCase()} · {(paper.last_signal.direction ?? "—").toUpperCase()} · risk {paper.last_signal.risk_allowed ? "ALLOW" : "BLOCK"}{paper.last_signal.paper_entry ? " · PAPER ENTRY" : ""}</p>}
          {paper.open_paper_position && <pre className="json-box">{JSON.stringify(paper.open_paper_position, null, 2)}</pre>}
          {paper.last_error && <pre className="error-box">{paper.last_error}</pre>}
          {paper.quote_errors && paper.quote_errors.length > 0 && <pre className="error-box">{paper.quote_errors.join("\n")}</pre>}
          <p className="muted">Universe dated {paper.universe_as_of ?? "—"}. Current V1 uses equal constituent weights; refresh real index weights before treating the cash score as production-grade.</p>
        </article>

        <article className="card span-4 command-card">
          <div className="title-with-icon"><div className="card-icon"><Icon name="terminal" /></div><div><span className="label">Latest command</span><h2>{status?.latestCommand?.command?.replaceAll("_", " ") ?? "No command"}</h2></div></div>
          <p className="command-state"><span className="status-dot neutral" />{status?.latestCommand?.status?.toUpperCase() ?? "—"}</p>
          <p className="muted">Created {fmtTime(status?.latestCommand?.created_at)}</p>
          {status?.latestCommand?.error && <pre className="error-box">{status.latestCommand.error}</pre>}
          {status?.latestCommand?.result && <pre className="json-box">{JSON.stringify(status.latestCommand.result, null, 2)}</pre>}
        </article>

        <article className="card span-4">
          <div className="title-with-icon"><div className="card-icon"><Icon name="database" /></div><div><span className="label">Control plane</span><h2 className={status?.controlPlane.healthy ? "good" : "bad"}>{status?.controlPlane.healthy ? "HEALTHY" : "DEGRADED"}</h2></div></div>
          <p className="muted">{status?.credentials.configured ? "Credentials encrypted" : "Credentials missing"}</p>
          <p className="muted">Paper status updated {fmtTime(paper.statusUpdatedAt)}</p>
        </article>

        <article className="card span-4">
          <div className="card-head"><div className="title-with-icon"><div className="card-icon"><Icon name="chart" /></div><div><span className="label">Live data diagnostic</span><h2>NIFTY snapshot</h2></div></div><span className="pill"><span className={`status-dot ${worker.market_data_status === "ok" ? "good" : "neutral"}`} />{worker.market_data_status ?? "unknown"}</span></div>
          {marketData ? <pre className="json-box tall">{JSON.stringify(marketData, null, 2)}</pre> : <div className="empty-state compact"><Icon name="chart" /><div><strong>Waiting for market data</strong><p>No successful Oracle market-data diagnostic yet.</p></div></div>}
          {worker.last_error && <pre className="error-box">{worker.last_error}</pre>}
        </article>

        <article className="card span-6">
          <div className="card-head"><div className="title-with-icon"><div className="card-icon"><Icon name="activity" /></div><div><span className="label">Algorithm</span><h2>Latest level-event signal</h2></div></div>{signal && <span className="confidence"><strong>{pct(signal.confidence)}</strong><small>confidence</small></span>}</div>
          {!signal ? <div className="empty-state"><Icon name="activity" /><div><strong>No signal recorded</strong><p>The latest Oracle engine signal will appear here.</p></div></div> : <>
            <div className="metric-grid">
              <div className="metric-wide"><span>State</span><strong>{signal.event.toUpperCase()} · {signal.direction.toUpperCase()}</strong></div>
              <div><span>Cash</span><strong>{signal.cash.score.toFixed(3)}</strong></div>
              <div><span>Futures</span><strong>{signal.futures.score.toFixed(3)}</strong></div>
              <div><span>Risk</span><strong className={signal.risk.allowed ? "good" : "warn"}>{signal.risk.allowed ? "ALLOW" : "BLOCK"}</strong></div>
            </div>
            <p className="signal-reasons">{signal.reasons.join(" · ")}</p>
          </>}
        </article>

        <article className="card span-6">
          <div className="card-head"><div className="title-with-icon"><div className="card-icon"><Icon name="layers" /></div><div><span className="label">Support / resistance</span><h2>Trading levels</h2></div></div><span className="pill">{status?.levels.length ?? 0} levels</span></div>
          <form className="level-form" onSubmit={saveLevel}>
            <label className="field"><span>Name</span><input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="S1 / R1" required /></label>
            <label className="field"><span>Type</span><select value={levelKind} onChange={(e) => setLevelKind(e.target.value as "support" | "resistance")}><option value="support">Support</option><option value="resistance">Resistance</option></select></label>
            <label className="field"><span>Price</span><input type="number" step="0.05" min="0" value={levelPrice} onChange={(e) => setLevelPrice(e.target.value)} placeholder="25,000" required /></label>
            <button className="primary add-button" disabled={busy === "level"}>{busy === "level" ? <Icon name="refresh" className="spin" /> : <Icon name="plus" />}<span>{busy === "level" ? "Saving…" : "Add level"}</span></button>
          </form>
          {!status?.levels.length ? <div className="empty-state compact"><Icon name="layers" /><div><strong>No levels configured</strong><p>Add your first support or resistance level above.</p></div></div> : <div className="level-table-wrap"><table className="level-table"><thead><tr><th>Name</th><th>Type</th><th>Price</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{status.levels.map((level) => <tr key={level.id}><td><strong>{level.name}</strong></td><td><span className={`level-kind ${level.kind}`}>{level.kind}</span></td><td className="price-cell">{Number(level.price).toLocaleString()}</td><td><span className={`level-status ${level.enabled ? "enabled" : "disabled"}`}><span className={`status-dot ${level.enabled ? "good" : "neutral"}`} />{level.enabled ? "Enabled" : "Disabled"}</span></td><td><button type="button" className="mini-danger" onClick={() => removeLevel(level.id)} disabled={busy === `delete-${level.id}`} aria-label={`Remove ${level.name}`}>{busy === `delete-${level.id}` ? <Icon name="refresh" className="spin" /> : <Icon name="trash" />}</button></td></tr>)}</tbody></table></div>}
        </article>
      </section>

      <footer className="dashboard-footer"><span><span className="status-dot good" />Secure control plane</span><span>Paper execution · No live orders</span></footer>
    </main>
  );
}
