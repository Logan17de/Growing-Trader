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
  metadata?: Record<string, unknown>;
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
  latestCommand: CommandStatus | null;
  credentials: { configured: boolean; updatedAt: string | null };
  latestSignal: { payload: SignalPayload; observed_at: string } | null;
  levels: Level[];
};

function pct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function fmtTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
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
        const isQueueNotice = current.startsWith(`${latest.command} queued`) || current.startsWith(`${latest.command} is already`);
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

  async function command(commandName: "TEST_AUTH" | "TEST_MARKET_DATA" | "STOP") {
    setBusy(commandName);
    setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandName }),
      });
      setNotice(result.duplicate ? `${commandName} is already queued/running.` : `${commandName} queued for Oracle.`);
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
    return <main className="center-shell"><div className="login-card"><p className="eyebrow">GROWING TRADER</p><h1>Loading control plane…</h1></div></main>;
  }

  if (auth === "guest") {
    return (
      <main className="center-shell">
        <form className="login-card" onSubmit={login}>
          <p className="eyebrow">GROWING TRADER</p>
          <h1>Trading control plane</h1>
          <p className="muted">Private dashboard for the Vercel ↔ Oracle ↔ Groww stack.</p>
          <label className="field"><span>Dashboard password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button className="primary" disabled={busy === "login"}>{busy === "login" ? "Signing in…" : "Open dashboard"}</button>
          {notice && <p className="notice error">{notice}</p>}
        </form>
      </main>
    );
  }

  const worker = status?.worker ?? {};
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
  const canBrokerTest = Boolean(worker.online && status?.credentials.configured && !busy);
  const canStop = Boolean(worker.online && !busy);

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">GROWING TRADER</p><h1>Market control</h1><p className="muted">Vercel controls. Supabase coordinates. Oracle owns Groww connectivity and algorithm execution.</p></div>
        <div className="top-actions"><span className="pill paper">PAPER ONLY</span><button className="ghost" onClick={logout}>Sign out</button></div>
      </header>

      {notice && <div className="notice">{notice}</div>}
      {Object.keys(backendErrors).length > 0 && (
        <div className="notice error">
          <strong>Control plane degraded.</strong>
          <pre className="error-box">{JSON.stringify(backendErrors, null, 2)}</pre>
        </div>
      )}

      <section className="status-strip">
        <article className="status-card"><span className="label">ORACLE</span><strong className={oracleClass}>{oracleState}</strong><small>{fmtTime(worker.last_heartbeat)}</small></article>
        <article className="status-card"><span className="label">GROWW AUTH</span><strong className={worker.groww_authenticated ? "good" : "warn"}>{worker.groww_authenticated ? "READY" : "NOT VERIFIED"}</strong><small>{worker.state ?? "idle"}</small></article>
        <article className="status-card"><span className="label">MARKET DATA</span><strong className={worker.market_data_status === "ok" ? "good" : worker.market_data_status === "error" ? "bad" : "warn"}>{(worker.market_data_status ?? "unknown").toUpperCase()}</strong><small>Oracle → Groww</small></article>
        <article className="status-card"><span className="label">CONTROL PLANE</span><strong className={status?.controlPlane.healthy ? "good" : "bad"}>{status?.controlPlane.healthy ? "HEALTHY" : "DEGRADED"}</strong><small>{status?.credentials.configured ? "Credentials encrypted" : "Credentials missing"}</small></article>
      </section>

      <section className="dashboard-grid">
        <article className="card span-2">
          <div className="card-head"><div><span className="label">BROKER CONNECTION</span><h2>Groww credentials</h2></div><span className="secure-badge">🔒 server-side encrypted</span></div>
          <p className="muted">Saving a new key/secret invalidates the previous Groww verification state. The credentials are never returned to the browser.</p>
          <form className="credential-form" onSubmit={saveCredentials}>
            <label className="field"><span>API key</span><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" required /></label>
            <label className="field"><span>API secret</span><input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" required /></label>
            <button className="primary" disabled={busy === "credentials"}>{busy === "credentials" ? "Encrypting…" : "Save encrypted credentials"}</button>
          </form>
        </article>

        <article className="card">
          <span className="label">ORACLE COMMANDS</span><h2>Connectivity tests</h2>
          {!worker.online && <p className="muted">Start the Oracle control agent before running commands.</p>}
          {worker.online && !status?.credentials.configured && <p className="muted">Save Groww credentials before running broker tests.</p>}
          <div className="button-stack">
            <button className="primary" onClick={() => command("TEST_AUTH")} disabled={!canBrokerTest}>Test Groww authentication</button>
            <button className="secondary" onClick={() => command("TEST_MARKET_DATA")} disabled={!canBrokerTest}>Test NIFTY market data</button>
            <button className="danger" onClick={() => command("STOP")} disabled={!canStop}>Stop Oracle agent</button>
          </div>
        </article>

        <article className="card">
          <span className="label">LATEST COMMAND</span><h2>{status?.latestCommand?.command ?? "No command"}</h2>
          <p className="command-state">{status?.latestCommand?.status?.toUpperCase() ?? "—"}</p>
          <p className="muted">Created {fmtTime(status?.latestCommand?.created_at)}</p>
          {status?.latestCommand?.error && <pre className="error-box">{status.latestCommand.error}</pre>}
          {status?.latestCommand?.result && <pre className="json-box">{JSON.stringify(status.latestCommand.result, null, 2)}</pre>}
        </article>

        <article className="card span-2">
          <div className="card-head"><div><span className="label">LIVE DATA</span><h2>NIFTY snapshot</h2></div><span className="pill">{worker.market_data_status ?? "unknown"}</span></div>
          {marketData ? <pre className="json-box tall">{JSON.stringify(marketData, null, 2)}</pre> : <p className="muted">No successful Oracle market-data result yet.</p>}
          {worker.last_error && <pre className="error-box">{worker.last_error}</pre>}
        </article>

        <article className="card span-2">
          <div className="card-head"><div><span className="label">ALGORITHM</span><h2>Latest level-event signal</h2></div>{signal && <span className="pill">{pct(signal.confidence)}</span>}</div>
          {!signal ? <p className="muted">No signal has been written by the Oracle engine yet.</p> : <>
            <div className="metric-grid">
              <div><span>State</span><strong>{signal.event.toUpperCase()} · {signal.direction.toUpperCase()}</strong></div>
              <div><span>Cash</span><strong>{signal.cash.score.toFixed(3)}</strong></div>
              <div><span>Futures</span><strong>{signal.futures.score.toFixed(3)}</strong></div>
              <div><span>Risk</span><strong className={signal.risk.allowed ? "good" : "warn"}>{signal.risk.allowed ? "ALLOW" : "BLOCK"}</strong></div>
            </div>
            <p className="muted">{signal.reasons.join(" · ")}</p>
          </>}
        </article>

        <article className="card span-2">
          <div className="card-head"><div><span className="label">SUPPORT / RESISTANCE</span><h2>Trading levels</h2></div><span className="pill">{status?.levels.length ?? 0} levels</span></div>
          <form className="level-form" onSubmit={saveLevel}>
            <label className="field"><span>Name</span><input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="S1 / R1" required /></label>
            <label className="field"><span>Type</span><select value={levelKind} onChange={(e) => setLevelKind(e.target.value as "support" | "resistance")}><option value="support">Support</option><option value="resistance">Resistance</option></select></label>
            <label className="field"><span>Price</span><input type="number" step="0.05" min="0" value={levelPrice} onChange={(e) => setLevelPrice(e.target.value)} placeholder="25000" required /></label>
            <button className="primary" disabled={busy === "level"}>{busy === "level" ? "Saving…" : "Save level"}</button>
          </form>
          {!status?.levels.length ? <p className="muted">No levels configured yet.</p> : <div className="level-list">{status.levels.map((level) => <div key={level.id}><strong>{level.name}</strong><span>{level.kind}</span><b>{Number(level.price).toLocaleString()}</b><em>{level.enabled ? "enabled" : "disabled"}</em><button className="mini-danger" onClick={() => removeLevel(level.id)} disabled={busy === `delete-${level.id}`}>Remove</button></div>)}</div>}
        </article>
      </section>
    </main>
  );
}
