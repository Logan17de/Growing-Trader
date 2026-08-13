import assert from "node:assert/strict";
import test from "node:test";
import { classifyMinuteDirection, compareThreshold, formatIndianVolume, latestContinuousRun, summarizeVolumeSession } from "./marketCalculations.ts";

test("formats volume using Indian compact units", () => {
  assert.equal(formatIndianVolume(25_000), "25K");
  assert.equal(formatIndianVolume(120_000), "1.2L");
  assert.equal(formatIndianVolume(1_200_000), "12L");
  assert.equal(formatIndianVolume(11_000_000), "1.1Cr");
});

test("classifies minute direction from consecutive NIFTY values", () => {
  assert.equal(classifyMinuteDirection(24_360, 24_350), "up");
  assert.equal(classifyMinuteDirection(24_340, 24_350), "down");
  assert.equal(classifyMinuteDirection(24_350, 24_350), "flat");
  assert.equal(classifyMinuteDirection(24_350), "flat");
});

test("summarizes minute volume and handles an empty dataset", () => {
  assert.equal(summarizeVolumeSession([]).current, null);
  assert.deepEqual(summarizeVolumeSession([
    { nifty_ltp: 1, constituent_volume_delta: 100, constituent_turnover: 1_000 },
    { nifty_ltp: 2, constituent_volume_delta: 300, constituent_turnover: 4_000 },
  ]), { current: 300, average: 200, relative: 1.5, cumulative: 400, currentTurnover: 4_000, cumulativeTurnover: 5_000 });
});

test("starts a fresh chart run after a missing minute", () => {
  const rows = [
    { observed_at: "2026-08-13T06:00:00.000Z", value: "old-a" },
    { observed_at: "2026-08-13T06:01:00.000Z", value: "old-b" },
    { observed_at: "2026-08-13T06:12:00.000Z", value: "new-a" },
    { observed_at: "2026-08-13T06:13:00.000Z", value: "new-b" },
  ];
  assert.deepEqual(latestContinuousRun(rows).map((row) => row.value), ["new-a", "new-b"]);
});

test("sorts the latest uninterrupted chart run chronologically", () => {
  const rows = [
    { observed_at: "2026-08-13T06:13:00.000Z", value: "second" },
    { observed_at: "2026-08-13T06:12:00.000Z", value: "first" },
  ];
  assert.deepEqual(latestContinuousRun(rows).map((row) => row.value), ["first", "second"]);
});

test("compares minimum and maximum thresholds with a near state", () => {
  assert.equal(compareThreshold(0.74, 0.68, ">="), "pass");
  assert.equal(compareThreshold(0.64, 0.68, ">="), "near");
  assert.equal(compareThreshold(0.4, 0.68, ">="), "fail");
  assert.equal(compareThreshold(8, 30, "<="), "pass");
  assert.equal(compareThreshold(undefined, 30, "<="), "unavailable");
});
