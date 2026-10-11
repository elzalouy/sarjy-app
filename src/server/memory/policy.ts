import "server-only";

// Profile preferences only. One short string per allowed key.
// A user statement can be stored immediately.
// An extracted fact is stored only when approved is true.
// A later allowed write replaces the previous value. That replacement is a correction.
// Passwords, tokens, card numbers, email addresses, and phone numbers are not stored.

export const allowedMemoryKeys = [
  "city",
  "language",
  "preferred_name",
] as const;

export type AllowedMemoryKey = (typeof allowedMemoryKeys)[number];

export const memoryValueLimits = {
  preferred_name: 40,
  city: 80,
} as const;

const languages = ["ar", "en"] as const;

export type MemorySource = "user" | "extracted";

export type MemoryRejectReason =
  | "disallowed_key"
  | "invalid_value"
  | "sensitive"
  | "approval_required"
  | "missing";

export type MemoryWriteReview =
  | { ok: true; key: AllowedMemoryKey; value: string }
  | { ok: false; reason: MemoryRejectReason };

export type MemoryRemovalReview =
  | { ok: true; key: AllowedMemoryKey }
  | { ok: false; reason: MemoryRejectReason };

const sensitiveWords =
  /\b(password|passwd|secret|token|api[-_ ]?key|bearer|ssn|cvv|credit card)\b/i;
const emailAddress = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const controlChars = /[\u0000-\u001f\u007f]/;

export class MemoryRejectedError extends Error {
  readonly reason: MemoryRejectReason;

  constructor(reason: MemoryRejectReason) {
    super(memoryRejectMessage(reason));
    this.name = "MemoryRejectedError";
    this.reason = reason;
  }
}

export function memoryRejectMessage(reason: MemoryRejectReason): string {
  if (reason === "approval_required") {
    return "That memory needs approval before it can be stored.";
  }
  if (reason === "missing") {
    return "There is no memory to correct.";
  }
  return "That memory cannot be stored.";
}

export function reviewMemoryWrite(input: {
  key: unknown;
  value: unknown;
  source: unknown;
  approved: unknown;
}): MemoryWriteReview {
  const key = reviewKey(input.key);
  if (key.ok === false) {
    return key;
  }
  const value = reviewValue(key.key, input.value);
  if (value.ok === false) {
    return value;
  }
  const approval = reviewApproval(input.source, input.approved);
  if (approval !== null) {
    return { ok: false, reason: approval };
  }
  return { ok: true, key: key.key, value: value.value };
}

export function reviewMemoryRemoval(input: {
  key: unknown;
  source: unknown;
  approved: unknown;
}): MemoryRemovalReview {
  const key = reviewKey(input.key);
  if (key.ok === false) {
    return key;
  }
  const approval = reviewApproval(input.source, input.approved);
  if (approval !== null) {
    return { ok: false, reason: approval };
  }
  return { ok: true, key: key.key };
}

function reviewKey(
  key: unknown,
):
  | { ok: true; key: AllowedMemoryKey }
  | { ok: false; reason: "disallowed_key" } {
  if (typeof key !== "string" || !isAllowedMemoryKey(key)) {
    return { ok: false, reason: "disallowed_key" };
  }
  return { ok: true, key };
}

function reviewValue(
  key: AllowedMemoryKey,
  value: unknown,
):
  | { ok: true; value: string }
  | { ok: false; reason: "invalid_value" | "sensitive" } {
  if (typeof value !== "string") {
    return { ok: false, reason: "invalid_value" };
  }
  const text =
    key === "language" ? normalizeLanguage(value) : normalizeText(value);
  if (text === null) {
    return { ok: false, reason: "invalid_value" };
  }
  if (key === "language" && !isLanguage(text)) {
    return { ok: false, reason: "invalid_value" };
  }
  if (
    key === "preferred_name" &&
    text.length > memoryValueLimits.preferred_name
  ) {
    return { ok: false, reason: "invalid_value" };
  }
  if (key === "city" && text.length > memoryValueLimits.city) {
    return { ok: false, reason: "invalid_value" };
  }
  if (isSensitive(text)) {
    return { ok: false, reason: "sensitive" };
  }
  return { ok: true, value: text };
}

function reviewApproval(
  source: unknown,
  approved: unknown,
): MemoryRejectReason | null {
  if (source !== "user" && source !== "extracted") {
    return "invalid_value";
  }
  if (source === "extracted" && approved !== true) {
    return "approval_required";
  }
  return null;
}

export function isAllowedMemoryKey(key: string): key is AllowedMemoryKey {
  return (allowedMemoryKeys as readonly string[]).includes(key);
}

function normalizeText(value: string): string | null {
  if (controlChars.test(value)) {
    return null;
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length === 0) {
    return null;
  }
  return text;
}

function normalizeLanguage(value: string): string | null {
  if (controlChars.test(value)) {
    return null;
  }
  const text = value.trim().toLowerCase();
  if (text.length === 0 || /\s/.test(text)) {
    return null;
  }
  return text;
}

function isLanguage(value: string): boolean {
  return (languages as readonly string[]).includes(value);
}

function isSensitive(text: string): boolean {
  if (sensitiveWords.test(text) || emailAddress.test(text)) {
    return true;
  }
  const digits = text.replace(/[\s().-]/g, "");
  return /\d{10,}/.test(digits) || /^\+\d{8,15}$/.test(digits);
}
