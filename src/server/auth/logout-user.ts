import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { revokeSessionByTokenHash } from "../database/sessions.ts";
import { hashSessionToken } from "./session-token.ts";

export async function logoutUser(
  prisma: PrismaClient,
  input: {
    token: string | null;
    sessionSecret: string;
    now: Date;
  },
): Promise<void> {
  if (input.token === null || input.token.length === 0) {
    return;
  }
  await revokeSessionByTokenHash(
    prisma,
    hashSessionToken(input.sessionSecret, input.token),
    input.now,
  );
}
