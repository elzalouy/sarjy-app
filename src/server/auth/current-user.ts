import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { findSessionByTokenHash } from "../database/sessions.ts";
import type { PublicUser } from "./public-user.ts";
import { toPublicUser } from "./public-user.ts";
import { hashSessionToken, sessionAccess } from "./session-token.ts";

export async function currentUser(
  prisma: PrismaClient,
  input: {
    token: string | null;
    sessionSecret: string;
    now: Date;
  },
): Promise<PublicUser | null> {
  if (input.token === null || input.token.length === 0) {
    return null;
  }
  const session = await findSessionByTokenHash(
    prisma,
    hashSessionToken(input.sessionSecret, input.token),
  );
  if (session === null) {
    return null;
  }
  const access = sessionAccess(
    {
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      status: session.user.status,
    },
    input.now,
  );
  if (access !== "valid") {
    return null;
  }
  return toPublicUser(session.user);
}
