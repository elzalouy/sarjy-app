import "server-only";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";

const KEY_MAX_LENGTH = 64;
const VALUE_MAX_JSON_LENGTH = 8_000;
const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredMemory = {
  id: string;
  userId: string;
  key: string;
  value: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryWrite = {
  memory: StoredMemory;
  created: boolean;
  changed: boolean;
};

export class InvalidMemoryError extends Error {
  constructor() {
    super("The memory is invalid.");
    this.name = "InvalidMemoryError";
  }
}

const memorySelect = {
  id: true,
  userId: true,
  key: true,
  value: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function upsertMemory(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: string;
    value: Prisma.InputJsonValue | null;
  },
): Promise<MemoryWrite> {
  const userId = readUserId(input.userId);
  const key = readKey(input.key);
  const value = readJsonValue(input.value);
  const existing = await findMemoryForUser(prisma, { userId, key });
  if (existing === null) {
    try {
      const memory = await prisma.memory.create({
        data: {
          userId,
          key,
          value: jsonData(value),
        },
        select: memorySelect,
      });
      return { memory, created: true, changed: true };
    } catch (error) {
      if (!isUniqueConstraint(error)) {
        throw new Error(safeDatabaseMessage(error));
      }
    }
  } else if (jsonEqual(existing.value, value)) {
    return { memory: existing, created: false, changed: false };
  }

  const memory = await replaceMemory(prisma, { userId, key, value });
  if (memory === null) {
    throw new Error("Could not store the memory.");
  }
  return { memory, created: false, changed: true };
}

export async function updateMemory(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: string;
    value: Prisma.InputJsonValue | null;
  },
): Promise<{ memory: StoredMemory; changed: boolean } | null> {
  const userId = readUserId(input.userId);
  const key = readKey(input.key);
  const value = readJsonValue(input.value);
  const existing = await findMemoryForUser(prisma, { userId, key });
  if (existing === null) {
    return null;
  }
  if (jsonEqual(existing.value, value)) {
    return { memory: existing, changed: false };
  }
  const memory = await replaceMemory(prisma, { userId, key, value });
  if (memory === null) {
    return null;
  }
  return { memory, changed: true };
}

export async function listMemoriesForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<StoredMemory[]> {
  return prisma.memory.findMany({
    where: { userId: readUserId(userId) },
    orderBy: [{ key: "asc" }, { id: "asc" }],
    select: memorySelect,
  });
}

export async function findMemoryForUser(
  prisma: PrismaClient,
  input: { userId: string; key: string },
): Promise<StoredMemory | null> {
  const userId = readUserId(input.userId);
  const key = readKey(input.key);
  return prisma.memory.findUnique({
    where: { userId_key: { userId, key } },
    select: memorySelect,
  });
}

export async function deleteMemory(
  prisma: PrismaClient,
  input: { userId: string; key: string },
): Promise<boolean> {
  const result = await prisma.memory.deleteMany({
    where: {
      userId: readUserId(input.userId),
      key: readKey(input.key),
    },
  });
  return result.count === 1;
}

async function replaceMemory(
  prisma: PrismaClient,
  input: {
    userId: string;
    key: string;
    value: Prisma.InputJsonValue | null;
  },
): Promise<StoredMemory | null> {
  try {
    const result = await prisma.memory.updateMany({
      where: { userId: input.userId, key: input.key },
      data: { value: jsonData(input.value) },
    });
    if (result.count !== 1) {
      return null;
    }
  } catch (error) {
    throw new Error(safeDatabaseMessage(error));
  }
  return prisma.memory.findUnique({
    where: { userId_key: { userId: input.userId, key: input.key } },
    select: memorySelect,
  });
}

function readUserId(userId: string): string {
  if (typeof userId !== "string" || !USER_ID.test(userId)) {
    throw new InvalidMemoryError();
  }
  return userId;
}

function readKey(key: string): string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > KEY_MAX_LENGTH
  ) {
    throw new InvalidMemoryError();
  }
  if (key.includes("\u0000") || key.trim().length === 0) {
    throw new InvalidMemoryError();
  }
  return key;
}

function readJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (!isJsonValue(value)) {
    throw new InvalidMemoryError();
  }
  if (JSON.stringify(value).length > VALUE_MAX_JSON_LENGTH) {
    throw new InvalidMemoryError();
  }
  return value;
}

function isJsonValue(value: unknown): value is Prisma.InputJsonValue | null {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

function jsonData(
  value: Prisma.InputJsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value;
}

function jsonEqual(
  stored: Prisma.JsonValue,
  next: Prisma.InputJsonValue | null,
): boolean {
  return stableJson(stored) === stableJson(next);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
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
    return `Could not store the memory (${(error as { code: string }).code}).`;
  }
  return "Could not store the memory.";
}
