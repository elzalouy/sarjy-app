import "server-only";
import { getServerConfig } from "../config/env.ts";
import { getPrismaClient } from "../database/prisma.ts";
import { logoutUser } from "./logout-user.ts";

export async function endSession(token: string | null): Promise<void> {
  if (token === null || token.length === 0) {
    return;
  }
  const config = getServerConfig();
  await logoutUser(getPrismaClient(), {
    token,
    sessionSecret: config.session.secret,
    now: new Date(),
  });
}
