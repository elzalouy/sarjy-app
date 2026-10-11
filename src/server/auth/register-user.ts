import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createUser } from "../database/users.ts";
import { normalizePhoneNumber } from "../shared/phone-number.ts";
import { hashPassword, assertPassword } from "./password.ts";
import { toPublicUser, type PublicUser } from "./public-user.ts";

export class DuplicatePhoneError extends Error {
  constructor() {
    super("That phone number is already registered.");
    this.name = "DuplicatePhoneError";
  }
}

export async function registerUser(
  prisma: PrismaClient,
  input: { phone: string; password: string },
): Promise<PublicUser> {
  const phoneNumber = normalizePhoneNumber(input.phone);
  assertPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await createUser(prisma, { phoneNumber, passwordHash });
    return toPublicUser(user);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new DuplicatePhoneError();
    }
    throw new Error(safeDatabaseMessage(error, "Could not create the user."));
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function safeDatabaseMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (/^P[0-9]+$/.test(code)) {
      return `${fallback} (${code}).`;
    }
  }
  return fallback;
}
