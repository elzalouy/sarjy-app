"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../components/alert.tsx";
import { Button } from "../../components/button.tsx";
import { LoadingIndicator } from "../../components/loading-indicator.tsx";
import { TranscriptList } from "../../components/transcript-list.tsx";
import {
  createConversation,
  endConversation,
  requestLiveKitToken,
} from "./call-api.ts";
import {
  createCallSession,
  type CallSession,
  type CallViewState,
} from "./call-session.ts";
import { callPhaseLabel, isLivePhase } from "./call-status.ts";
import { connectLiveKitRoom } from "./livekit-room.ts";

const idleState: CallViewState = {
  phase: "idle",
  mic: "off",
  lines: [],
  error: null,
  conversationId: null,
  busy: false,
};

export function CallScreen() {
  const [state, setState] = useState<CallViewState>(idleState);
  const sessionRef = useRef<CallSession | null>(null);

  useEffect(() => {
    const created = createCallSession({
      createConversation,
      requestToken: requestLiveKitToken,
      endConversation,
      connectRoom: connectLiveKitRoom,
    });
    sessionRef.current = created;
    const unsubscribe = created.subscribe(setState);
    return () => {
      unsubscribe();
      sessionRef.current = null;
      void created.dispose();
    };
  }, []);

  const live = isLivePhase(state.phase);
  const canStart = !live && !state.busy;
  const canMute = state.mic === "on" || state.mic === "muted";

  return (
    <main className="ui-call">
      <header className="ui-call-head">
        <div>
          <p className="ui-call-kicker">Assistant</p>
          <h1 className="ui-call-identity">Sarjy</h1>
        </div>
        <div className="ui-status-row">
          <span>
            Connection <strong>{callPhaseLabel(state.phase)}</strong>
          </span>
          <span>
            Microphone <strong>{micLabel(state.mic)}</strong>
          </span>
        </div>
      </header>

      {state.phase === "connecting" ? (
        <p className="ui-status-row">
          <LoadingIndicator label="Connecting" />
          Starting the call…
        </p>
      ) : null}
      {state.error !== null ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="ui-transcript-panel">
        <TranscriptList lines={state.lines} />
      </div>

      <div className="ui-call-controls">
        <Button
          type="button"
          disabled={!canStart}
          onClick={() => {
            void sessionRef.current?.start();
          }}
        >
          {state.phase === "connecting" ? "Connecting…" : "Start call"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canMute}
          onClick={() => {
            void sessionRef.current?.setMuted(state.mic !== "muted");
          }}
        >
          {state.mic === "muted" ? "Unmute" : "Mute"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!live}
          onClick={() => {
            void sessionRef.current?.end();
          }}
        >
          End call
        </Button>
      </div>
    </main>
  );
}

function micLabel(mic: CallViewState["mic"]): string {
  switch (mic) {
    case "off":
      return "Off";
    case "on":
      return "On";
    case "muted":
      return "Muted";
    case "denied":
      return "Denied";
  }
}
