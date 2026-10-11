import type {
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TranscriptionSegment,
} from "livekit-client";
import type { TranscriptLine } from "./captions.ts";
import type { RoomSignal, VoiceConnection } from "./call-session.ts";

export async function connectLiveKitRoom(
  url: string,
  token: string,
): Promise<VoiceConnection> {
  const { ParticipantKind, Room, RoomEvent, Track } =
    await import("livekit-client");
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const listeners = new Set<(signal: RoomSignal) => void>();
  const pending: RoomSignal[] = [];
  const cleanups: Array<() => void> = [];
  const elements: HTMLMediaElement[] = [];

  function emit(signal: RoomSignal) {
    if (listeners.size === 0) {
      pending.push(signal);
      return;
    }
    for (const listener of listeners) {
      listener(signal);
    }
  }

  function roleOf(participant?: Participant): "user" | "assistant" {
    if (
      participant === undefined ||
      participant.isLocal ||
      participant.identity === room.localParticipant.identity
    ) {
      return "user";
    }
    return "assistant";
  }

  function isAgent(participant: Participant): boolean {
    return participant.kind === ParticipantKind.AGENT;
  }

  const onParticipantConnected = (participant: RemoteParticipant) => {
    if (isAgent(participant)) {
      emit({ type: "agent_joined" });
    }
  };
  const onParticipantDisconnected = (participant: RemoteParticipant) => {
    if (isAgent(participant)) {
      emit({ type: "agent_left" });
    }
  };
  const onSpeakers = (speakers: Participant[]) => {
    emit({
      type: "agent_speaking",
      speaking: speakers.some((speaker) => isAgent(speaker)),
    });
  };
  const onReconnecting = () => {
    emit({ type: "reconnecting" });
  };
  const onReconnected = () => {
    emit({ type: "reconnected" });
  };
  const onDisconnected = () => {
    emit({ type: "disconnected" });
  };
  const onCaptions = (
    segments: TranscriptionSegment[],
    participant?: Participant,
  ) => {
    const role = roleOf(participant);
    const lines: TranscriptLine[] = [];
    for (const segment of segments) {
      if (segment.text.trim().length === 0) {
        continue;
      }
      lines.push({
        id: segment.id,
        role,
        text: segment.text,
        final: segment.final,
        language: segment.language,
      });
    }
    if (lines.length > 0) {
      emit({ type: "captions", lines });
    }
  };
  const onTrack = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track.kind !== Track.Kind.Audio || participant.isLocal) {
      return;
    }
    emit({ type: "remote_audio" });
    const element = track.attach();
    element.autoplay = true;
    elements.push(element);
    if (typeof document !== "undefined") {
      document.body.append(element);
    }
    element.addEventListener(
      "playing",
      () => {
        emit({ type: "remote_playback" });
      },
      { once: true },
    );
  };

  room
    .on(RoomEvent.ParticipantConnected, onParticipantConnected)
    .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    .on(RoomEvent.ActiveSpeakersChanged, onSpeakers)
    .on(RoomEvent.Reconnecting, onReconnecting)
    .on(RoomEvent.Reconnected, onReconnected)
    .on(RoomEvent.Disconnected, onDisconnected)
    .on(RoomEvent.TranscriptionReceived, onCaptions)
    .on(RoomEvent.TrackSubscribed, onTrack);

  cleanups.push(() => {
    room
      .off(RoomEvent.ParticipantConnected, onParticipantConnected)
      .off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      .off(RoomEvent.ActiveSpeakersChanged, onSpeakers)
      .off(RoomEvent.Reconnecting, onReconnecting)
      .off(RoomEvent.Reconnected, onReconnected)
      .off(RoomEvent.Disconnected, onDisconnected)
      .off(RoomEvent.TranscriptionReceived, onCaptions)
      .off(RoomEvent.TrackSubscribed, onTrack);
  });

  await room.connect(url, token);
  for (const participant of room.remoteParticipants.values()) {
    if (participant.kind === ParticipantKind.AGENT) {
      emit({ type: "agent_joined" });
    }
  }

  return {
    async setMicrophone(enabled: boolean) {
      await room.localParticipant.setMicrophoneEnabled(enabled);
    },
    async startAudio() {
      await room.startAudio();
    },
    async disconnect() {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
      for (const element of elements) {
        element.pause();
        element.srcObject = null;
        element.remove();
      }
      elements.length = 0;
      await room.localParticipant
        .setMicrophoneEnabled(false)
        .catch(() => undefined);
      await room.disconnect();
    },
    subscribe(listener) {
      listeners.add(listener);
      const queued = pending.splice(0, pending.length);
      for (const signal of queued) {
        listener(signal);
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
