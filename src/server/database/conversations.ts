import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";

export type ConversationPageCursor = {
  createdAt: Date;
  id: string;
};

const MESSAGE_MAX_LENGTH = 8_000;
const EVENT_ID_MAX_LENGTH = 128;

export type StoredConversation = {
  id: string;
  userId: string;
  roomName: string;
  status: "active" | "ended" | "failed";
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  providerEventId: string | null;
};

export class InvalidMessageError extends Error {
  constructor() {
    super("The message is invalid.");
    this.name = "InvalidMessageError";
  }
}

export async function createConversation(
  prisma: PrismaClient,
  input: { userId: string; roomName: string },
): Promise<StoredConversation> {
  return prisma.conversation.create({
    data: {
      userId: input.userId,
      roomName: input.roomName,
      status: "active",
    },
    select: conversationSelect,
  });
}

export async function findConversationById(
  prisma: PrismaClient,
  id: string,
): Promise<StoredConversation | null> {
  return prisma.conversation.findUnique({
    where: { id },
    select: conversationSelect,
  });
}

export async function findConversationForOwner(
  prisma: PrismaClient,
  input: { id: string; userId: string },
): Promise<StoredConversation | null> {
  return prisma.conversation.findFirst({
    where: { id: input.id, userId: input.userId },
    select: conversationSelect,
  });
}

export async function listConversationsForOwner(
  prisma: PrismaClient,
  input: {
    userId: string;
    limit: number;
    cursor: ConversationPageCursor | null;
  },
): Promise<StoredConversation[]> {
  return prisma.conversation.findMany({
    where: {
      userId: input.userId,
      ...(input.cursor === null
        ? {}
        : {
            OR: [
              { createdAt: { lt: input.cursor.createdAt } },
              {
                createdAt: input.cursor.createdAt,
                id: { lt: input.cursor.id },
              },
            ],
          }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit,
    select: conversationSelect,
  });
}

export async function endActiveConversation(
  prisma: PrismaClient,
  input: { id: string; userId: string; endedAt: Date },
): Promise<boolean> {
  const result = await prisma.conversation.updateMany({
    where: {
      id: input.id,
      userId: input.userId,
      status: "active",
    },
    data: {
      status: "ended",
      endedAt: input.endedAt,
      updatedAt: input.endedAt,
    },
  });
  return result.count === 1;
}

export async function failActiveConversation(
  prisma: PrismaClient,
  input: { id: string; userId: string; endedAt: Date },
): Promise<boolean> {
  const result = await prisma.conversation.updateMany({
    where: {
      id: input.id,
      userId: input.userId,
      status: "active",
    },
    data: {
      status: "failed",
      endedAt: input.endedAt,
      updatedAt: input.endedAt,
    },
  });
  return result.count === 1;
}

export async function listMessages(
  prisma: PrismaClient,
  input: {
    conversationId: string;
    limit: number;
    cursor: ConversationPageCursor | null;
  },
): Promise<StoredMessage[]> {
  return prisma.message.findMany({
    where: {
      conversationId: input.conversationId,
      ...(input.cursor === null
        ? {}
        : {
            OR: [
              { createdAt: { gt: input.cursor.createdAt } },
              {
                createdAt: input.cursor.createdAt,
                id: { gt: input.cursor.id },
              },
            ],
          }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: input.limit,
    select: messageSelect,
  });
}

export async function createMessage(
  prisma: PrismaClient,
  input: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    providerEventId?: string | null;
    createdAt?: Date;
  },
): Promise<{ message: StoredMessage; created: boolean }> {
  const content = input.content;
  const providerEventId = input.providerEventId ?? null;
  if (!isValidMessage(content, providerEventId)) {
    throw new InvalidMessageError();
  }
  try {
    const message = await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: input.role,
        content,
        providerEventId,
        ...(input.createdAt === undefined
          ? {}
          : { createdAt: input.createdAt }),
      },
      select: messageSelect,
    });
    return { message, created: true };
  } catch (error) {
    if (providerEventId !== null && isUniqueConstraint(error)) {
      const existing = await prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          providerEventId,
        },
        select: messageSelect,
      });
      if (existing !== null) {
        return { message: existing, created: false };
      }
    }
    throw new Error(safeDatabaseMessage(error));
  }
}

const conversationSelect = {
  id: true,
  userId: true,
  roomName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  endedAt: true,
} as const;

const messageSelect = {
  id: true,
  conversationId: true,
  role: true,
  content: true,
  createdAt: true,
  providerEventId: true,
} as const;

function isValidMessage(
  content: string,
  providerEventId: string | null,
): boolean {
  if (typeof content !== "string" || content.length === 0) {
    return false;
  }
  if (content.length > MESSAGE_MAX_LENGTH) {
    return false;
  }
  if (providerEventId === null) {
    return true;
  }
  return (
    providerEventId.length > 0 && providerEventId.length <= EVENT_ID_MAX_LENGTH
  );
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
    return `Could not store the message (${(error as { code: string }).code}).`;
  }
  return "Could not store the message.";
}
