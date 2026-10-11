import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { StoredUser } from "./users.ts";

export type StoredSession = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  user: StoredUser;
};

export async function createSession(
  prisma: PrismaClient,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    },
  });
}

export async function findSessionByTokenHash(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<StoredSession | null> {
  return prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          phoneNumber: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function revokeSessionByTokenHash(
  prisma: PrismaClient,
  tokenHash: string,
  revokedAt: Date,
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: { revokedAt },
  });
}
