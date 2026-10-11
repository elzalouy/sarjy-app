import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  createMessage,
  findConversationById,
} from "../database/conversations.ts";
import {
  ConversationNotActiveError,
  ConversationNotFoundError,
} from "./access.ts";
import { toPublicMessage, type PublicMessage } from "./public-conversation.ts";

export type TranscriptResult = {
  message: PublicMessage;
  created: boolean;
};

export async function ingestTranscript(
  prisma: PrismaClient,
  input: {
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    eventId: string | null;
    createdAt: Date | null;
  },
): Promise<TranscriptResult> {
  const conversation = await findConversationById(prisma, input.conversationId);
  if (conversation === null || conversation.userId !== input.userId) {
    throw new ConversationNotFoundError();
  }
  if (conversation.status !== "active") {
    throw new ConversationNotActiveError();
  }

  const saved = await createMessage(prisma, {
    conversationId: conversation.id,
    role: input.role,
    content: input.content,
    providerEventId: input.eventId,
    ...(input.createdAt === null ? {} : { createdAt: input.createdAt }),
  });
  return {
    message: toPublicMessage(saved.message),
    created: saved.created,
  };
}
