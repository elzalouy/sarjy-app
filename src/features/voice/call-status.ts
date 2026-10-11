export type CallPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "ended"
  | "error";

export type CallEvent =
  | { type: "start" }
  | { type: "room_connected" }
  | { type: "agent_joined" }
  | { type: "agent_left" }
  | { type: "agent_speaking"; speaking: boolean }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "ended" }
  | { type: "failed" };

export type CallPhaseState = {
  phase: CallPhase;
  agentPresent: boolean;
};

export function initialCallPhase(): CallPhaseState {
  return { phase: "idle", agentPresent: false };
}

export function reduceCallPhase(
  state: CallPhaseState,
  event: CallEvent,
): CallPhaseState {
  if (event.type === "start") {
    if (state.phase === "idle" || state.phase === "ended" || state.phase === "error") {
      return { phase: "connecting", agentPresent: false };
    }
    return state;
  }
  if (event.type === "ended") {
    return { phase: "ended", agentPresent: false };
  }
  if (event.type === "failed") {
    return { phase: "error", agentPresent: false };
  }
  if (state.phase === "idle" || state.phase === "ended" || state.phase === "error") {
    return state;
  }
  if (event.type === "reconnecting") {
    return { phase: "reconnecting", agentPresent: state.agentPresent };
  }
  if (event.type === "room_connected") {
    return {
      phase: state.agentPresent ? "listening" : "connected",
      agentPresent: state.agentPresent,
    };
  }
  if (event.type === "agent_joined") {
    return {
      phase: state.phase === "reconnecting" ? "reconnecting" : "listening",
      agentPresent: true,
    };
  }
  if (event.type === "agent_left") {
    return {
      phase: state.phase === "reconnecting" ? "reconnecting" : "connected",
      agentPresent: false,
    };
  }
  if (event.type === "agent_speaking") {
    if (!state.agentPresent) {
      return state;
    }
    if (state.phase === "reconnecting") {
      return state;
    }
    return {
      phase: event.speaking ? "speaking" : "listening",
      agentPresent: true,
    };
  }
  if (event.type === "reconnected") {
    return {
      phase: state.agentPresent ? "listening" : "connected",
      agentPresent: state.agentPresent,
    };
  }
  return state;
}

export function callPhaseLabel(phase: CallPhase): string {
  switch (phase) {
    case "idle":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "listening":
      return "Listening";
    case "speaking":
      return "Speaking";
    case "reconnecting":
      return "Reconnecting";
    case "ended":
      return "Call ended";
    case "error":
      return "Could not connect";
  }
}

export function isLivePhase(phase: CallPhase): boolean {
  return (
    phase === "connecting" ||
    phase === "connected" ||
    phase === "listening" ||
    phase === "speaking" ||
    phase === "reconnecting"
  );
}
