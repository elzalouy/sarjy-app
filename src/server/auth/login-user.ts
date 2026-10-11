import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createSession } from "../database/sessions.ts";
import { findUserForLogin } from "../database/users.ts";
import { normalizePhoneNumber } from "../shared/phone-number.ts";
import {
  assertPassword,
  dummyPasswordHash,
  verifyPassword,
} from "./password.ts";
import { toPublicUser, type PublicUser } from "./public-user.ts";
import { createSessionToken, hashSessionToken } from "./session-token.ts";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("The phone number or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

export type LoginResult = {
  user: PublicUser;
  token: string;
  expiresAt: Date;
};

export async function loginUser(
  prisma: PrismaClient,
  input: {
    phone: string;
    password: string;
    sessionSecret: string;
    maxAgeSeconds: number;
    now: Date;
  },
): Promise<LoginResult> {
  const phoneNumber = normalizePhoneNumber(input.phone);
  assertPassword(input.password);

  const user = await findUserForLogin(prisma, phoneNumber);
  const passwordHash = user?.passwordHash ?? (await dummyPasswordHash());
  const passwordMatches = await verifyPassword(input.password, passwordHash);
  if (user === null || user.status !== "active" || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  const token = createSessionToken();
  const expiresAt = new Date(
    input.now.getTime() + input.maxAgeSeconds * 1000,
  );
  await createSession(prisma, {
    userId: user.id,
    tokenHash: hashSessionToken(input.sessionSecret, token),
    expiresAt,
  });

  return {
    user: toPublicUser(user),
    token,
    expiresAt,
  };
}
