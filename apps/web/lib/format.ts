export function formatNumber(value?: number | null, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: digits })
    : "Unavailable";
}

export function formatCurrency(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 })
    : "Unavailable";
}

export function formatPercent(value?: number | null, source: "ratio" | "percent" = "ratio"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${(source === "ratio" ? value * 100 : value).toFixed(1)}%`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" });
}

export function formatDuration(start?: string | null): string {
  if (!start) return "Unavailable";
  const started = Date.parse(start);
  if (!Number.isFinite(started)) return "Unavailable";
  const seconds = Math.max(Math.floor((Date.now() - started) / 1000), 0);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function isSameLocalDay(value: string, now = new Date()): boolean {
  const date = new Date(value);
  return date.toDateString() === now.toDateString();
}
