import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, apiErrorCodes } from "../shared/api-error.ts";

const invalidCredential = "The service credential is invalid.";

/**
 * The Python agent sends Authorization: Bearer <token>.
 * Compare it with INTERNAL_SERVICE_TOKEN.
 * During rotation, INTERNAL_SERVICE_TOKEN_PREVIOUS is also accepted.
 * Remove the previous token after the agent uses the new one.
 * Outbound calls to the agent must abort after timeoutMs.
 */
export function assertServiceCredential(
  request: Request,
  tokens: { current: string; previous: string | null },
): void {
  const presented = bearerToken(request.headers.get("authorization"));
  const accepted = [tokens.current, tokens.previous].filter(
    (token): token is string => token !== null && token.length > 0,
  );
  if (
    presented === null ||
    !accepted.some((token) => sameToken(presented, token))
  ) {
    throw new ApiError(401, apiErrorCodes.unauthorized, invalidCredential);
  }
}

export function serviceCallSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function bearerToken(header: string | null): string | null {
  if (header === null || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length === 0 ? null : token;
}

function sameToken(presented: string, expected: string): boolean {
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
