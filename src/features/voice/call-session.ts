import type { TranscriptLine } from "./captions.ts";
import { applyCaptions } from "./captions.ts";
import type { CallTiming, CallTimingName } from "./call-timings.ts";
import { createCallTimings } from "./call-timings.ts";
import {
  initialCallPhase,
  isLivePhase,
  reduceCallPhase,
  type CallPhase,
} from "./call-status.ts";

export type MicState = "off" | "on" | "muted" | "denied";

export type CallViewState = {
  phase: CallPhase;
  mic: MicState;
  lines: TranscriptLine[];
  error: string | null;
  conversationId: string | null;
  busy: boolean;
};

export type RoomSignal =
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "disconnected" }
  | { type: "agent_joined" }
  | { type: "agent_left" }
  | { type: "agent_speaking"; speaking: boolean }
  | { type: "remote_audio" }
  | { type: "remote_playback" }
  | { type: "captions"; lines: TranscriptLine[] };

export type VoiceConnection = {
  setMicrophone(enabled: boolean): Promise<void>;
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (signal: RoomSignal) => void): () => void;
};

export type CallSessionDeps = {
  createConversation: () => Promise<{ id: string }>;
  requestToken: (
    conversationId: string,
  ) => Promise<{ token: string; url: string }>;
  endConversation: (conversationId: string) => Promise<void>;
  connectRoom: (url: string, token: string) => Promise<VoiceConnection>;
  now?: () => number;
};

export type CallSession = {
  start: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  end: () => Promise<void>;
  dispose: () => Promise<void>;
  getState: () => CallViewState;
  timings: () => readonly CallTiming[];
  subscribe: (listener: (state: CallViewState) => void) => () => void;
};

export function createCallSession(deps: CallSessionDeps): CallSession {
  let phase = initialCallPhase();
  let view = idleView();
  let connection: VoiceConnection | null = null;
  let unsubscribeRoom: (() => void) | null = null;
  let run = 0;
  let startPromise: Promise<void> | null = null;
  const listeners = new Set<(state: CallViewState) => void>();
  const timings = createCallTimings(deps.now);

  function emit(next: CallViewState) {
    view = next;
    for (const listener of listeners) {
      listener(view);
    }
  }

  function applyPhase(event: Parameters<typeof reduceCallPhase>[1]) {
    phase = reduceCallPhase(phase, event);
    emit({ ...view, phase: phase.phase });
  }

  function mark(name: CallTimingName, conversationId: string | null) {
    timings.mark(name, conversationId);
  }

  function onRoom(signal: RoomSignal) {
    if (signal.type === "captions") {
      emit({ ...view, lines: applyCaptions(view.lines, signal.lines) });
      return;
    }
    if (signal.type === "agent_joined") {
      mark("agent_joined", view.conversationId);
      applyPhase({ type: "agent_joined" });
      return;
    }
    if (signal.type === "agent_left") {
      applyPhase({ type: "agent_left" });
      return;
    }
    if (signal.type === "agent_speaking") {
      applyPhase({ type: "agent_speaking", speaking: signal.speaking });
      return;
    }
    if (signal.type === "reconnecting") {
      applyPhase({ type: "reconnecting" });
      return;
    }
    if (signal.type === "reconnected") {
      applyPhase({ type: "reconnected" });
      return;
    }
    if (signal.type === "remote_audio") {
      mark("remote_audio_track", view.conversationId);
      return;
    }
    if (signal.type === "remote_playback") {
      mark("remote_audio_playback", view.conversationId);
      return;
    }
    if (signal.type === "disconnected" && isLivePhase(view.phase)) {
      connection = null;
      unsubscribeRoom?.();
      unsubscribeRoom = null;
      phase = reduceCallPhase(phase, { type: "failed" });
      emit({
        ...view,
        phase: "error",
        mic: "off",
        busy: false,
        error: "The call disconnected.",
      });
    }
  }

  async function start(): Promise<void> {
    if (startPromise !== null) {
      return startPromise;
    }
    if (isLivePhase(view.phase)) {
      return;
    }
    const current = run + 1;
    run = current;
    startPromise = runStart(current).finally(() => {
      if (startPromise !== null && current === run) {
        startPromise = null;
      }
    });
    return startPromise;
  }

  async function runStart(current: number): Promise<void> {
    phase = reduceCallPhase(initialCallPhase(), { type: "start" });
    emit({
      phase: "connecting",
      mic: "off",
      lines: [],
      error: null,
      conversationId: null,
      busy: true,
    });
    mark("start_click", null);
    let conversationId: string | null = null;
    try {
      const created = await deps.createConversation();
      if (current !== run) {
        await deps.endConversation(created.id);
        return;
      }
      conversationId = created.id;
      emit({ ...view, conversationId });
      mark("token_request_start", conversationId);
      const issued = await deps.requestToken(conversationId);
      mark("token_request_end", conversationId);
      if (current !== run) {
        await deps.endConversation(conversationId);
        return;
      }
      mark("room_connect_start", conversationId);
      const room = await deps.connectRoom(issued.url, issued.token);
      mark("room_connect_end", conversationId);
      if (current !== run) {
        await room.disconnect();
        await deps.endConversation(conversationId);
        return;
      }
      connection = room;
      unsubscribeRoom = room.subscribe(onRoom);
      await room.startAudio();
      phase = reduceCallPhase(phase, { type: "room_connected" });
      emit({ ...view, phase: phase.phase, busy: true });
      try {
        await room.setMicrophone(true);
        if (current !== run) {
          return;
        }
        emit({ ...view, mic: "on", busy: false });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          throw error;
        }
        emit({
          ...view,
          mic: "denied",
          busy: false,
          error: "Microphone permission was denied.",
        });
      }
    } catch (error) {
      await releaseRoom();
      if (conversationId !== null && current === run) {
        await deps.endConversation(conversationId).catch(() => undefined);
      }
      if (current === run) {
        phase = reduceCallPhase(phase, { type: "failed" });
        emit({
          ...view,
          phase: "error",
          mic: "off",
          busy: false,
          error: safeCallMessage(error),
        });
      }
    }
  }

  async function setMuted(muted: boolean): Promise<void> {
    if (connection === null || view.mic === "denied" || view.mic === "off") {
      return;
    }
    await connection.setMicrophone(!muted);
    emit({ ...view, mic: muted ? "muted" : "on" });
  }

  async function end(): Promise<void> {
    run += 1;
    startPromise = null;
    const conversationId = view.conversationId;
    await releaseRoom();
    phase = reduceCallPhase(phase, { type: "ended" });
    emit({
      ...view,
      phase: "ended",
      mic: "off",
      busy: false,
    });
    if (conversationId !== null) {
      await deps.endConversation(conversationId).catch(() => undefined);
    }
  }

  async function releaseRoom(): Promise<void> {
    const room = connection;
    connection = null;
    unsubscribeRoom?.();
    unsubscribeRoom = null;
    if (room !== null) {
      await room.disconnect();
    }
  }

  return {
    start,
    setMuted,
    end,
    dispose: end,
    getState: () => view,
    timings: () => timings.events,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function idleView(): CallViewState {
  return {
    phase: "idle",
    mic: "off",
    lines: [],
    error: null,
    conversationId: null,
    busy: false,
  };
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotAllowedError" || error.name === "NotFoundError")
  );
}

function safeCallMessage(error: unknown): string {
  if (error instanceof Error && isPermissionDenied(error)) {
    return error.name === "NotFoundError"
      ? "No microphone was found."
      : "Microphone permission was denied.";
  }
  if (
    error instanceof Error &&
    error.message.length > 0 &&
    error.message.length < 160 &&
    !error.message.includes("eyJ") &&
    !/signal connection|failed to fetch|websocket/i.test(error.message)
  ) {
    return error.message;
  }
  return "Could not start the call.";
}
