"use client";

import { useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/controlClient";
import type { ControlStatus, TradingDataSnapshot } from "@/lib/terminalTypes";

export type TerminalAuthState = "checking" | "guest" | "ready";

function unavailableStatus(message: string): ControlStatus {
  return {
    controlPlane: { healthy: false, errors: { status: message } },
    worker: { online: false, stale: false, state: "offline", market_data_status: "unavailable" },
    paperEngine: { running: false, state: "unavailable", feed_connected: false },
    latestCommand: null,
    credentials: { configured: false, updatedAt: null },
    latestSignal: null,
    recentSignals: [],
    levels: [],
    paperOrders: [],
    paperTrades: [],
    paperOutcomes: [],
  };
}

export function useTerminalStatus(defaultPollIntervalMs = 3000) {
  const [auth, setAuth] = useState<TerminalAuthState>("checking");
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refreshTradingData = useCallback(async () => {
    try {
      const data = await jsonRequest<TradingDataSnapshot>("/api/control/trading");
      setStatus((current) => current ? { ...current, ...data } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to load trading history";
      if (message === "unauthorized") setAuth("guest");
      else setError((current) => current || `Trading history: ${message}`);
    }
  }, []);

  const refresh = useCallback(async (background = false) => {
    if (!background) setRefreshing(true);
    try {
      const data = await jsonRequest<ControlStatus>("/api/control/status");
      setStatus((current) => ({
        ...data,
        recentSignals: data.recentSignals ?? current?.recentSignals ?? [],
        paperOrders: data.paperOrders ?? current?.paperOrders ?? [],
        paperTrades: data.paperTrades ?? current?.paperTrades ?? [],
        paperOutcomes: data.paperOutcomes ?? current?.paperOutcomes ?? [],
      }));
      setAuth("ready");
      setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to load terminal status";
      if (message === "unauthorized") {
        setAuth("guest");
        setStatus(null);
      } else {
        setAuth("ready");
        setError(message);
        setStatus((current) => current ?? unavailableStatus(message));
      }
    } finally {
      if (!background) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void jsonRequest<{ authenticated: boolean }>("/api/auth/status")
      .then((result) => result.authenticated ? refresh() : setAuth("guest"))
      .catch(() => setAuth("guest"));
  }, [refresh]);

  const pollIntervalMs = status?.terminalPreferences?.refresh_interval_ms ?? defaultPollIntervalMs;
  useEffect(() => {
    if (auth !== "ready" || pollIntervalMs <= 0) return;
    const timer = window.setInterval(() => void refresh(true), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [auth, pollIntervalMs, refresh]);

  useEffect(() => {
    if (auth !== "ready") return;
    void refreshTradingData();
    const timer = window.setInterval(() => void refreshTradingData(), Math.max(pollIntervalMs * 5, 10_000));
    return () => window.clearInterval(timer);
  }, [auth, pollIntervalMs, refreshTradingData]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatus(null);
    setAuth("guest");
  }, []);

  const refreshAll = useCallback(async () => {
    await refresh();
    await refreshTradingData();
  }, [refresh, refreshTradingData]);

  return { auth, status, error, refreshing, refresh: refreshAll, logout };
}
