"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchStatusPayload } from "@/lib/researchTypes";

export function useResearchData(refreshMs = 10_000, enabled = true) {
  const [data, setData] = useState<ResearchStatusPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/control/research", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body as ResearchStatusPayload);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load research state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [enabled, refresh, refreshMs]);

  return { data, error, loading, refresh };
}
