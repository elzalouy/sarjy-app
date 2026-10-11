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

  const hosts = requestHosts(request);
  if (
    hosts.length === 0 ||
    !hosts.some((host) => originMatchesHost(origin, host))
  ) {
    throw blockedRequest();
  }
}

function requestHosts(request: Request): string[] {
  const hosts: string[] = [];
  const header = request.headers.get("host");
  if (header !== null && isHostHeader(header)) {
    hosts.push(header);
  }
  try {
    hosts.push(new URL(request.url).host);
  } catch {
    // The request URL is not used when it cannot be parsed.
  }
  return hosts;
}

function isHostHeader(host: string): boolean {
  return host.length > 0 && host.length <= 255 && !/[\s/@\\]/.test(host);
}

function originMatchesHost(origin: string, host: string): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
  ) {
    return false;
  }
  try {
    return new URL(`${originUrl.protocol}//${host}`).host === originUrl.host;
  } catch {
    return false;
  }
}

function blockedRequest(): ApiError {
  return new ApiError(403, apiErrorCodes.forbidden, blocked);
}
