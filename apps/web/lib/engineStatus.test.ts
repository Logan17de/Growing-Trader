import assert from "node:assert/strict";
import test from "node:test";
import { getEngineHeaderStatus } from "./engineStatus.ts";
import type { ControlStatus } from "./terminalTypes.ts";

function status(paperEngine: ControlStatus["paperEngine"], mode: "paper" | "live" = "paper", armed = false): ControlStatus {
  return { paperEngine, executionControl: { mode, live_armed: armed } } as ControlStatus;
}

test("shows the selected execution mode in the header", () => {
  assert.equal(getEngineHeaderStatus(status({ running: false }, "paper")).modeLabel, "PAPER");
  assert.equal(getEngineHeaderStatus(status({ running: true }, "live", true)).modeLabel, "LIVE · ARMED");
  assert.equal(getEngineHeaderStatus(status({ running: true }, "live", false)).modeLabel, "LIVE · DISARMED");
});

test("maps engine truth to the five visible runtime phases", () => {
  assert.equal(getEngineHeaderStatus(status({ running: false, state: "stopped" })).phase, "inactive");
  assert.equal(getEngineHeaderStatus(status({ running: true, state: "warming", feed_connected: true })).phase, "warming");
  assert.equal(getEngineHeaderStatus(status({ running: true, state: "error" })).phase, "error");
  assert.equal(getEngineHeaderStatus(status({ running: true, state: "running", feed_connected: true, open_position: { trading_symbol: "NIFTY" } })).phase, "trading");
  assert.equal(getEngineHeaderStatus(status({ running: true, state: "running", feed_connected: true })).phase, "watching");
});
