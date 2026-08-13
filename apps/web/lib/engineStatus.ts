import type { ControlStatus } from "./terminalTypes";

export type EnginePhase = "inactive" | "warming" | "error" | "trading" | "watching";

export type EngineHeaderStatus = {
  mode: "paper" | "live";
  armed: boolean;
  modeLabel: string;
  phase: EnginePhase;
  phaseLabel: string;
  phaseTone: "neutral" | "warn" | "bad" | "good" | "info";
};

export function getEngineHeaderStatus(status: ControlStatus | null): EngineHeaderStatus {
  const engine = status?.paperEngine ?? {};
  const mode = status?.executionControl?.mode ?? engine.mode ?? "paper";
  const armed = Boolean(status?.executionControl?.live_armed ?? engine.live_armed);
  const state = (engine.state ?? "").toLowerCase();
  const position = engine.open_position ?? engine.open_paper_position;

  let phase: EnginePhase;
  if (state === "error") phase = "error";
  else if (!engine.running || state === "stopped" || state === "stopping") phase = "inactive";
  else if (["starting", "warming", "waiting_market"].includes(state) || !engine.feed_connected) phase = "warming";
  else if (position) phase = "trading";
  else phase = "watching";

  const presentation: Record<EnginePhase, Pick<EngineHeaderStatus, "phaseLabel" | "phaseTone">> = {
    inactive: { phaseLabel: "INACTIVE", phaseTone: "neutral" },
    warming: { phaseLabel: "WARMING", phaseTone: "warn" },
    error: { phaseLabel: "ERROR", phaseTone: "bad" },
    trading: { phaseLabel: "TRADING", phaseTone: "good" },
    watching: { phaseLabel: "WATCHING", phaseTone: "info" },
  };

  return {
    mode,
    armed,
    modeLabel: mode === "live" ? (armed ? "LIVE · ARMED" : "LIVE · DISARMED") : "PAPER",
    phase,
    ...presentation[phase],
  };
}
