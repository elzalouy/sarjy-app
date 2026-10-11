import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  failActiveConversation,
  findConversationForOwner,
} from "../database/conversations.ts";
import { ConversationNotFoundError } from "./access.ts";
import { nextConversationStatus } from "./lifecycle.ts";
import {
  toPublicConversation,
  type PublicConversation,
} from "./public-conversation.ts";

export async function failConversationForUser(
  prisma: PrismaClient,
  input: { userId: string; conversationId: string; now: Date },
): Promise<PublicConversation> {
  const current = await findConversationForOwner(prisma, {
    id: input.conversationId,
    userId: input.userId,
  });
  if (current === null) {
    throw new ConversationNotFoundError();
  }

  const next = nextConversationStatus(current.status, "fail");
  if (next === current.status) {
    return toPublicConversation(current);
  }

  await failActiveConversation(prisma, {
    id: current.id,
    userId: input.userId,
    endedAt: input.now,
  });
  const latest = await findConversationForOwner(prisma, {
    id: current.id,
    userId: input.userId,
  });
  if (latest === null) {
    throw new ConversationNotFoundError();
  }
  return toPublicConversation(latest);
}
