import "server-only";
import { createHmac, randomBytes } from "node:crypto";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export type SessionAccessInput = {
  expiresAt: Date;
  revokedAt: Date | null;
  status: "active" | "disabled";
};

export function sessionAccess(
  session: SessionAccessInput,
  now: Date,
): "valid" | "rejected" {
  if (session.revokedAt !== null) {
    return "rejected";
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return "rejected";
  }
  if (session.status !== "active") {
    return "rejected";
  }
  return "valid";
}
