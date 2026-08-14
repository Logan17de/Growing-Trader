export type MinuteDirection = "up" | "down" | "flat";

export type VolumeLikePoint = {
  nifty_ltp: number;
  constituent_volume_delta: number;
  constituent_turnover: number;
};

export type TimedPoint = {
  observed_at: string;
};

export type ThresholdOperator = ">=" | "<=";
export type ThresholdState = "pass" | "near" | "fail" | "unavailable";

export function formatIndianVolume(value: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const formatted = (scaled: number) => scaled.toFixed(scaled >= 10 ? 0 : 1).replace(/\.0$/, "");
  if (absolute >= 10_000_000) return `${sign}${formatted(absolute / 10_000_000)}Cr`;
  if (absolute >= 100_000) return `${sign}${formatted(absolute / 100_000)}L`;
  if (absolute >= 1_000) return `${sign}${formatted(absolute / 1_000)}K`;
  return `${sign}${Math.round(absolute).toLocaleString("en-IN")}`;
}

export function classifyMinuteDirection(current: number, previous?: number | null): MinuteDirection {
  if (!Number.isFinite(current) || typeof previous !== "number" || !Number.isFinite(previous)) return "flat";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function latestContinuousRun<T extends TimedPoint>(points: T[], maxGapMs = 90_000): T[] {
  const chronological = points
    .map((point, index) => ({ point, index, time: Date.parse(point.observed_at) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time || left.index - right.index);
  if (chronological.length === 0) return [];

  let runStart = 0;
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].time - chronological[index - 1].time > maxGapMs) runStart = index;
  }
  return chronological.slice(runStart).map((item) => item.point);
}

export function summarizeVolumeSession(points: VolumeLikePoint[]) {
  const valid = points.filter((point) => Number.isFinite(point.constituent_volume_delta));
  if (valid.length === 0) {
    return { current: null, average: null, relative: null, cumulative: null, currentTurnover: null, cumulativeTurnover: null };
  }
  const current = Math.max(valid.at(-1)?.constituent_volume_delta ?? 0, 0);
  const cumulative = valid.reduce((sum, point) => sum + Math.max(point.constituent_volume_delta, 0), 0);
  const average = cumulative / valid.length;
  return {
    current,
    average,
    relative: average > 0 ? current / average : null,
    cumulative,
    currentTurnover: Math.max(valid.at(-1)?.constituent_turnover ?? 0, 0),
    cumulativeTurnover: valid.reduce((sum, point) => sum + Math.max(point.constituent_turnover, 0), 0),
  };
}

export function compareThreshold(value: number | null | undefined, required: number | null | undefined, operator: ThresholdOperator): ThresholdState {
  if (typeof value !== "number" || !Number.isFinite(value) || typeof required !== "number" || !Number.isFinite(required)) return "unavailable";
  const passed = operator === ">=" ? value >= required : value <= required;
  if (passed) return "pass";
  const tolerance = Math.max(Math.abs(required) * 0.1, 0.02);
  const distance = operator === ">=" ? required - value : value - required;
  return distance <= tolerance ? "near" : "fail";
}
