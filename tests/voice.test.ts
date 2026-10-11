import type { CallPhaseState } from "../src/features/voice/call-status.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const { applyCaptions, captionDirection } = await import(
  "../src/features/voice/captions.ts"
);
const { createCallTimings } = await import(
  "../src/features/voice/call-timings.ts"
);
const { callPhaseLabel, reduceCallPhase } = await import(
  "../src/features/voice/call-status.ts"
);
const { createCallSession } = await import(
  "../src/features/voice/call-session.ts"
);

test("captions keep order, replace partials, and set direction", () => {
  const partial = {
    id: "a",
    role: "assistant" as const,
    text: "مر",
    final: false,
    language: "ar",
  };
  const first = applyCaptions([], [partial]);
  const updated = applyCaptions(first, [
    { ...partial, text: "مرحبا", final: true },
    {
      id: "b",
      role: "user",
      text: "Hello مرحبا",
      final: true,
      language: "en",
    },
  ]);

  assert.deepEqual(
    updated.map((line) => line.id),
    ["a", "b"],
  );
  assert.equal(updated[0]?.text, "مرحبا");
  assert.equal(updated[0]?.final, true);
  assert.equal(captionDirection("مرحبا"), "rtl");
  assert.equal(captionDirection("Hello"), "ltr");
  assert.equal(captionDirection("Hello مرحبا"), "auto");
  assert.equal(callPhaseLabel("listening"), "Listening");
});

test("call phase follows room events and not an earlier guess", () => {
  let state: CallPhaseState = { phase: "idle", agentPresent: false };
  state = reduceCallPhase(state, { type: "start" });
  assert.equal(state.phase, "connecting");
  state = reduceCallPhase(state, { type: "room_connected" });
  assert.equal(state.phase, "connected");
  state = reduceCallPhase(state, { type: "agent_speaking", speaking: true });
  assert.equal(state.phase, "connected");
  state = reduceCallPhase(state, { type: "agent_joined" });
  assert.equal(state.phase, "listening");
  state = reduceCallPhase(state, { type: "agent_speaking", speaking: true });
  assert.equal(state.phase, "speaking");
  state = reduceCallPhase(state, { type: "reconnecting" });
  assert.equal(state.phase, "reconnecting");
  state = reduceCallPhase(state, { type: "reconnected" });
  assert.equal(state.phase, "listening");
  state = reduceCallPhase(state, { type: "agent_left" });
  assert.equal(state.phase, "connected");
  state = reduceCallPhase(state, { type: "ended" });
  assert.equal(state.phase, "ended");
});

test("call timings stay on one clock and omit credentials", () => {
  let clock = 1_000;
  const timings = createCallTimings(() => clock);
  const logs: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => {
    logs.push(String(line));
  };
  try {
    timings.mark("start_click", null);
    clock = 1_250;
    timings.mark("token_request_end", "conversation-1");
    timings.mark("token_request_end", "conversation-1");
  } finally {
    console.info = original;
  }

  assert.deepEqual(
    timings.events.map((event) => event.elapsedMs),
    [0, 250],
  );
  assert.equal(timings.events[1]?.conversationId, "conversation-1");
  assert.equal(logs.join("\n").includes("eyJ"), false);
  assert.equal(logs.join("\n").includes("secret-room-token"), false);
});

test("repeated start clicks open one call and end releases the room", async () => {
  let creates = 0;
  let connects = 0;
  let ends = 0;
  let disconnected = 0;
  let micEnabled: boolean | null = null;
  let releaseCreate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });

  const session = createCallSession({
    createConversation: () => {
      creates += 1;
      return gate.then(() => ({ id: "conversation-1" }));
    },
    requestToken: async () => ({
      token: "secret-room-token",
      url: "wss://livekit.example/room",
    }),
    endConversation: async () => {
      ends += 1;
    },
    connectRoom: async () => {
      connects += 1;
      return {
        async setMicrophone(enabled: boolean) {
          micEnabled = enabled;
        },
        async startAudio() {
          return undefined;
        },
        async disconnect() {
          disconnected += 1;
        },
        subscribe() {
          return () => undefined;
        },
      };
    },
  });

  const first = session.start();
  const second = session.start();
  assert.equal(releaseCreate === undefined, false);
  releaseCreate?.();
  await first;
  await second;

  assert.equal(creates, 1);
  assert.equal(connects, 1);
  assert.equal(micEnabled, true);
  assert.equal(session.getState().phase, "connected");
  assert.equal(
    JSON.stringify(session.getState()).includes("secret-room-token"),
    false,
  );
  assert.equal(
    JSON.stringify(session.timings()).includes("secret-room-token"),
    false,
  );
  assert.equal(
    session.timings().some((event) => event.name === "room_connect_end"),
    true,
  );

  await session.setMuted(true);
  assert.equal(micEnabled, false);
  assert.equal(session.getState().mic, "muted");

  await session.end();
  assert.equal(disconnected, 1);
  assert.equal(ends, 1);
  assert.equal(session.getState().phase, "ended");
  assert.equal(session.getState().mic, "off");
});

test("a denied microphone does not drop the room connection", async () => {
  const session = createCallSession({
    createConversation: async () => ({ id: "conversation-2" }),
    requestToken: async () => ({ token: "t", url: "wss://example" }),
    endConversation: async () => undefined,
    connectRoom: async () => ({
      async setMicrophone() {
        const error = new Error("permission");
        error.name = "NotAllowedError";
        throw error;
      },
      async startAudio() {
        return undefined;
      },
      async disconnect() {
        return undefined;
      },
      subscribe(listener) {
        listener({ type: "agent_joined" });
        return () => undefined;
      },
    }),
  });

  await session.start();
  assert.equal(session.getState().mic, "denied");
  assert.equal(session.getState().phase, "listening");
  assert.equal(
    session.getState().error,
    "Microphone permission was denied.",
  );
});
