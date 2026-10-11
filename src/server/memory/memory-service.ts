import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  deleteMemory,
  listMemoriesForUser,
  updateMemory,
  upsertMemory,
} from "../database/memories.ts";
import {
  MemoryRejectedError,
  reviewMemoryRemoval,
  reviewMemoryWrite,
} from "./policy.ts";

export type PublicMemory = {
  key: string;
  value: string;
  updatedAt: Date;
};

export async function rememberMemoryForUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: unknown;
    value: unknown;
    source: unknown;
    approved: unknown;
  },
): Promise<PublicMemory> {
  const reviewed = reviewMemoryWrite(input);
  if (!reviewed.ok) {
    throw new MemoryRejectedError(reviewed.reason);
  }
  const result = await upsertMemory(prisma, {
    userId: input.userId,
    key: reviewed.key,
    value: reviewed.value,
  });
  return toPublicMemory(result.memory);
}

export async function correctMemoryForUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: unknown;
    value: unknown;
    source: unknown;
    approved: unknown;
  },
): Promise<PublicMemory> {
  const reviewed = reviewMemoryWrite(input);
  if (!reviewed.ok) {
    throw new MemoryRejectedError(reviewed.reason);
  }
  const result = await updateMemory(prisma, {
    userId: input.userId,
    key: reviewed.key,
    value: reviewed.value,
  });
  if (result === null) {
    throw new MemoryRejectedError("missing");
  }
  return toPublicMemory(result.memory);
}

export async function forgetMemoryForUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: unknown;
    source: unknown;
    approved: unknown;
  },
): Promise<boolean> {
  const reviewed = reviewMemoryRemoval(input);
  if (!reviewed.ok) {
    throw new MemoryRejectedError(reviewed.reason);
  }
  return deleteMemory(prisma, {
    userId: input.userId,
    key: reviewed.key,
  });
}

export async function listMemoryForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<PublicMemory[]> {
  const rows = await listMemoriesForUser(prisma, userId);
  const memories: PublicMemory[] = [];
  for (const row of rows) {
    if (typeof row.value !== "string") {
      continue;
    }
    memories.push({
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    });
  }
  return memories;
}

function toPublicMemory(memory: {
  key: string;
  value: unknown;
  updatedAt: Date;
}): PublicMemory {
  if (typeof memory.value !== "string") {
    throw new Error("Could not store the memory.");
  }
  return {
    key: memory.key,
    value: memory.value,
    updatedAt: memory.updatedAt,
  };
}
