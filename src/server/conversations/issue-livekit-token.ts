import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { findConversationForOwner } from "../database/conversations.ts";
import {
  createParticipantToken,
  PARTICIPANT_TOKEN_TTL_SECONDS,
} from "../integrations/livekit-token.ts";
import {
  ConversationNotActiveError,
  ConversationNotFoundError,
} from "./access.ts";

export type ParticipantToken = {
  token: string;
  url: string;
  expiresInSeconds: number;
};

export async function issueLivekitToken(
  prisma: PrismaClient,
  input: {
    userId: string;
    conversationId: string;
    apiKey: string;
    apiSecret: string;
    agentName: string;
    publicUrl: string;
  },
): Promise<ParticipantToken> {
  const conversation = await findConversationForOwner(prisma, {
    id: input.conversationId,
    userId: input.userId,
  });
  if (conversation === null) {
    throw new ConversationNotFoundError();
  }
  if (conversation.status !== "active") {
    throw new ConversationNotActiveError();
  }

  const token = await createParticipantToken({
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    identity: input.userId,
    roomName: conversation.roomName,
    agentName: input.agentName,
  });
  return {
    token,
    url: input.publicUrl,
    expiresInSeconds: PARTICIPANT_TOKEN_TTL_SECONDS,
  };
}
