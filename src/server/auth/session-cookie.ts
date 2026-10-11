import "server-only";

export function sessionCookie(input: {
  name: string;
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  return serialize(input.name, input.token, input.maxAgeSeconds, input.secure);
}

export function clearedSessionCookie(input: {
  name: string;
  secure: boolean;
}): string {
  return serialize(input.name, "", 0, input.secure);
}

export function readSessionCookie(
  header: string | null,
  name: string,
): string | null {
  if (header === null || header.length === 0) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator) !== name) {
      continue;
    }
    const value = trimmed.slice(separator + 1);
    return value.length === 0 ? null : value;
  }
  return null;
}

function serialize(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
