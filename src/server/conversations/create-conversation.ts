import "server-only";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createConversation } from "../database/conversations.ts";
import {
  toPublicConversation,
  type PublicConversation,
} from "./public-conversation.ts";

const ROOM_NAME_ATTEMPTS = 3;

export async function createConversationForUser(
  prisma: PrismaClient,
  input: { userId: string },
): Promise<PublicConversation> {
  for (let attempt = 0; attempt < ROOM_NAME_ATTEMPTS; attempt += 1) {
    try {
      const conversation = await createConversation(prisma, {
        userId: input.userId,
        roomName: newRoomName(),
      });
      return toPublicConversation(conversation);
    } catch (error) {
      if (!isUniqueConstraint(error) || attempt === ROOM_NAME_ATTEMPTS - 1) {
        throw new Error(safeDatabaseMessage(error));
      }
    }
  }
  throw new Error("Could not create the conversation.");
}

function newRoomName(): string {
  return `room_${randomBytes(16).toString("hex")}`;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function safeDatabaseMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^P[0-9]+$/.test((error as { code: string }).code)
  ) {
    return `Could not create the conversation (${(error as { code: string }).code}).`;
  }
  return "Could not create the conversation.";
}
