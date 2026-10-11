import "server-only";
import { randomBytes } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// Argon2id is the library default. memoryCost 19456 KiB and timeCost 2 match the OWASP Argon2id baseline.
const argon2Options: Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export class InvalidPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPasswordError";
  }
}

export function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new InvalidPasswordError("Enter a password.");
  }
  if (password.includes("\u0000")) {
    throw new InvalidPasswordError("Enter a password.");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new InvalidPasswordError(
      `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new InvalidPasswordError(
      `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  try {
    return await hash(password, argon2Options);
  } catch {
    throw new Error("Password hashing failed.");
  }
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (typeof password !== "string" || typeof passwordHash !== "string") {
    return false;
  }
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash(
    randomBytes(32).toString("base64url"),
    argon2Options,
  ).catch(() => {
    dummyHash = undefined;
    throw new Error("Password hashing failed.");
  });
  return dummyHash;
}
