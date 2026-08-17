"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/terminal/Icon";

type Format = "csv" | "jsonl";

function filenameFromDisposition(value: string | null, fallback: string) {
  if (!value) return fallback;
  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

export function MarketWatchDownload({ days }: { days: 1 | 7 | 30 | 90 }) {
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [error, setError] = useState("");

  async function download(format: Format) {
    try {
      setDownloading(format);
      setError("");
      const response = await fetch(`/api/control/market-watch/export?days=${days}&format=${format}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `Market Watch ${format.toUpperCase()} export failed`);
      }
      const blob = await response.blob();
      const fallback = `market-watch-${days}d.${format}`;
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), fallback);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Market Watch export failed");
    } finally {
      setDownloading(null);
    }
  }

  return <div>
    <div className="hero-actions" aria-label="Market Watch research actions">
      <button className="primary" type="button" disabled={downloading != null} onClick={() => void download("csv")}>
        <Icon name={downloading === "csv" ? "refresh" : "download"} className={downloading === "csv" ? "spin" : ""} />
        {downloading === "csv" ? "Preparing CSV…" : "Export CSV"}
      </button>
      <button className="ghost" type="button" disabled={downloading != null} onClick={() => void download("jsonl")}>
        <Icon name={downloading === "jsonl" ? "refresh" : "download"} className={downloading === "jsonl" ? "spin" : ""} />
        {downloading === "jsonl" ? "Preparing JSONL…" : "Export JSONL"}
      </button>
      <Link className="secondary" href="/strategies">
        <Icon name="strategy" />Analyze &amp; build strategy<Icon name="arrow-right" />
      </Link>
    </div>
    {error && <p className="availability-note bad" role="alert">{error}</p>}
  </div>;
}
