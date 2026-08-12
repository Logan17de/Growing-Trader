"use client";

import { useCallback, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/controlClient";
import type { ControlStatus } from "@/lib/terminalTypes";

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

export function useTerminalStatus(pollIntervalMs = 3000) {
  const [auth, setAuth] = useState<TerminalAuthState>("checking");
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (background = false) => {
    if (!background) setRefreshing(true);
    try {
      const data = await jsonRequest<ControlStatus>("/api/control/status");
      setStatus({
        ...data,
        recentSignals: data.recentSignals ?? [],
        paperOrders: data.paperOrders ?? [],
        paperTrades: data.paperTrades ?? [],
        paperOutcomes: data.paperOutcomes ?? [],
      });
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

  useEffect(() => {
    if (auth !== "ready" || pollIntervalMs <= 0) return;
    const timer = window.setInterval(() => void refresh(true), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [auth, pollIntervalMs, refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatus(null);
    setAuth("guest");
  }, []);

  return { auth, status, error, refreshing, refresh, logout };
}
