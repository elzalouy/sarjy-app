import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { findConversationById } from "../database/conversations.ts";
import {
  ConversationNotActiveError,
  ConversationNotFoundError,
} from "./access.ts";

/**
 * Voice session contract:
 * The browser user comes from the session cookie, never from the request body.
 * The agent authenticates with the internal service token.
 * The agent may send a conversation id and room name.
 * A user id in that request is checked against the conversation owner.
 * It is never used as the source of the user id.
 * The returned user id is the owner stored for that conversation.
 * Only an active conversation can be authorized.
 */
export type VoiceSessionContext = {
  conversationId: string;
  userId: string;
  roomName: string;
};

export async function authorizeVoiceSession(
  prisma: PrismaClient,
  input: {
    conversationId: string;
    roomName: string;
    claimedUserId: string | null;
  },
): Promise<VoiceSessionContext> {
  const conversation = await findConversationById(prisma, input.conversationId);
  if (
    conversation === null ||
    conversation.roomName !== input.roomName ||
    (input.claimedUserId !== null &&
      input.claimedUserId !== conversation.userId)
  ) {
    throw new ConversationNotFoundError();
  }
  if (conversation.status !== "active") {
    throw new ConversationNotActiveError();
  }
  return {
    conversationId: conversation.id,
    userId: conversation.userId,
    roomName: conversation.roomName,
  };
}
