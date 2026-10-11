import "server-only";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
  TrackSource,
} from "livekit-server-sdk";

export const PARTICIPANT_TOKEN_TTL_SECONDS = 600;

export async function createParticipantToken(input: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  roomName: string;
  agentName: string;
  conversationId: string;
}): Promise<string> {
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    ttl: PARTICIPANT_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
    roomAdmin: false,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
    ingressAdmin: false,
    canUpdateOwnMetadata: false,
    hidden: false,
    recorder: false,
    agent: false,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: input.agentName,
        metadata: JSON.stringify({ conversationId: input.conversationId }),
      }),
    ],
  });
  return token.toJwt();
}
