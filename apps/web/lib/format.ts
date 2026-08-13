export const MARKET_TIME_ZONE = "Asia/Kolkata";

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

export function marketDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function marketHour(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).format(date));
  return Number.isFinite(hour) ? hour : null;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : `${date.toLocaleString("en-IN", { timeZone: MARKET_TIME_ZONE, dateStyle: "medium", timeStyle: "medium" })} IST`;
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
  return marketDateKey(value) === marketDateKey(now);
}
