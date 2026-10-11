import "server-only";
import { ApiError, apiErrorCodes } from "./api-error";

const blocked = "This request was blocked.";

export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw blockedRequest();
  }

  const origin = request.headers.get("origin");
  if (origin === null || origin.length === 0) {
    return;
  }

  let expected = "";
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw blockedRequest();
  }
  if (origin !== expected) {
    throw blockedRequest();
  }
}

function blockedRequest(): ApiError {
  return new ApiError(403, apiErrorCodes.forbidden, blocked);
}
