import "server-only";
import { RequestValidationError } from "../shared/validate-request.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PageCursor = {
  createdAt: Date;
  id: string;
};

export function encodePageCursor(input: PageCursor): string {
  return Buffer.from(
    `${input.createdAt.toISOString()}|${input.id}`,
    "utf8",
  ).toString("base64url");
}

export function readPageCursor(value: string | null): PageCursor | null {
  if (value === null || value.length === 0) {
    return null;
  }
  if (value.length > 200) {
    throw invalidCursor();
  }
  let decoded = "";
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }
  const separator = decoded.indexOf("|");
  if (separator <= 0) {
    throw invalidCursor();
  }
  const timestamp = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const createdAt = new Date(timestamp);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== timestamp ||
    !UUID_PATTERN.test(id)
  ) {
    throw invalidCursor();
  }
  return { createdAt, id };
}

export function readPageLimit(
  value: string | null,
  fallback: number,
  max: number,
): number {
  if (value === null || value.length === 0) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw invalidLimit();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw invalidLimit();
  }
  return parsed;
}

function invalidCursor(): RequestValidationError {
  return new RequestValidationError([
    { name: "cursor", message: "The cursor is invalid." },
  ]);
}

function invalidLimit(): RequestValidationError {
  return new RequestValidationError([
    { name: "limit", message: "The page size is invalid." },
  ]);
}
