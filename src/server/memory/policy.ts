import "server-only";

// Any preference key can be stored.
// A user statement can be stored immediately.
// An extracted fact is stored only when approved is true.
// A later write for the same key replaces the previous value.
// Passwords, tokens, card numbers, email addresses, and phone numbers are not stored.

const KEY_MAX_LENGTH = 64;
const VALUE_MAX_LENGTH = 80;

export type MemorySource = "user" | "extracted";

export type MemoryRejectReason =
  | "invalid_value"
  | "sensitive"
  | "approval_required"
  | "missing";

export type MemoryWriteReview =
  | { ok: true; key: string; value: string }
  | { ok: false; reason: MemoryRejectReason };

export type MemoryRemovalReview =
  | { ok: true; key: string }
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
  const value = reviewValue(input.value);
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
  | { ok: true; key: string }
  | { ok: false; reason: "invalid_value" | "sensitive" } {
  if (typeof key !== "string") {
    return { ok: false, reason: "invalid_value" };
  }
  const text = normalizeText(key);
  if (text === null || text.length > KEY_MAX_LENGTH) {
    return { ok: false, reason: "invalid_value" };
  }
  if (isSensitive(text)) {
    return { ok: false, reason: "sensitive" };
  }
  return { ok: true, key: text };
}

function reviewValue(
  value: unknown,
):
  | { ok: true; value: string }
  | { ok: false; reason: "invalid_value" | "sensitive" } {
  if (typeof value !== "string") {
    return { ok: false, reason: "invalid_value" };
  }
  const text = normalizeText(value);
  if (text === null || text.length > VALUE_MAX_LENGTH) {
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

function isSensitive(text: string): boolean {
  const words = text.replace(/[_-]+/g, " ");
  if (sensitiveWords.test(words) || emailAddress.test(text)) {
    return true;
  }
  const digits = text.replace(/[\s().-]/g, "");
  return /\d{10,}/.test(digits) || /^\+\d{8,15}$/.test(digits);
}
