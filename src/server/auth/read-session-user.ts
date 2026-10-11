import "server-only";
import { getServerConfig } from "../config/env.ts";
import { getPrismaClient } from "../database/prisma.ts";
import { currentUser } from "./current-user.ts";
import type { PublicUser } from "./public-user.ts";

export async function readSessionUser(
  token: string | null,
): Promise<PublicUser | null> {
  if (token === null || token.length === 0) {
    return null;
  }
  const config = getServerConfig();
  return currentUser(getPrismaClient(), {
    token,
    sessionSecret: config.session.secret,
    now: new Date(),
  });
}
