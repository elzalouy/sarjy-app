export const callTimingNames = [
  "start_click",
  "token_request_start",
  "token_request_end",
  "room_connect_start",
  "room_connect_end",
  "agent_joined",
  "remote_audio_track",
  "remote_audio_playback",
] as const;

export type CallTimingName = (typeof callTimingNames)[number];

export type CallTiming = {
  name: CallTimingName;
  conversationId: string | null;
  elapsedMs: number;
};

export function createCallTimings(now: () => number = () => performance.now()) {
  const origin = now();
  const events: CallTiming[] = [];
  const seen = new Set<CallTimingName>();

  return {
    events,
    mark(name: CallTimingName, conversationId: string | null): CallTiming {
      if (name !== "start_click" && seen.has(name)) {
        const previous = events.findLast((event) => event.name === name);
        if (previous !== undefined) {
          return previous;
        }
      }
      seen.add(name);
      const event: CallTiming = {
        name,
        conversationId,
        elapsedMs: Math.max(0, Math.round(now() - origin)),
      };
      events.push(event);
      console.info(
        JSON.stringify({
          source: "voice",
          name: event.name,
          conversationId: event.conversationId,
          elapsedMs: event.elapsedMs,
        }),
      );
      return event;
    },
  };
}
