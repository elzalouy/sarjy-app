import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  findConversationForOwner,
  listConversationsForOwner,
  listMessages,
} from "../database/conversations.ts";
import { ConversationNotFoundError } from "./access.ts";
import type { PageCursor } from "./page-cursor.ts";
import {
  toPublicConversation,
  toPublicMessage,
  type PublicConversation,
  type PublicMessage,
} from "./public-conversation.ts";

export async function getConversationForUser(
  prisma: PrismaClient,
  input: { userId: string; conversationId: string },
): Promise<PublicConversation> {
  const conversation = await findConversationForOwner(prisma, {
    id: input.conversationId,
    userId: input.userId,
  });
  if (conversation === null) {
    throw new ConversationNotFoundError();
  }
  return toPublicConversation(conversation);
}

export async function listConversationsForUser(
  prisma: PrismaClient,
  input: { userId: string; limit: number; cursor: PageCursor | null },
): Promise<{
  conversations: PublicConversation[];
  nextCursor: PageCursor | null;
}> {
  const rows = await listConversationsForOwner(prisma, {
    userId: input.userId,
    limit: input.limit + 1,
    cursor: input.cursor,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    conversations: page.map(toPublicConversation),
    nextCursor:
      rows.length <= input.limit || last === undefined
        ? null
        : { createdAt: last.createdAt, id: last.id },
  };
}

export async function listMessagesForUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    conversationId: string;
    limit: number;
    cursor: PageCursor | null;
  },
): Promise<{ messages: PublicMessage[]; nextCursor: PageCursor | null }> {
  const conversation = await findConversationForOwner(prisma, {
    id: input.conversationId,
    userId: input.userId,
  });
  if (conversation === null) {
    throw new ConversationNotFoundError();
  }
  const rows = await listMessages(prisma, {
    conversationId: conversation.id,
    limit: input.limit + 1,
    cursor: input.cursor,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    messages: page.map(toPublicMessage),
    nextCursor:
      rows.length <= input.limit || last === undefined
        ? null
        : { createdAt: last.createdAt, id: last.id },
  };
}
