import "server-only";

const DEFAULT_MAX_LENGTH = 1000;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export type FieldIssue = {
  readonly name: string;
  readonly message: string;
};

export type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: FieldIssue };

export type StringRules = {
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  pattern?: RegExp;
  patternMessage?: string;
};

export type IntegerRules = {
  min?: number;
  max?: number;
};

export class RequestValidationError extends Error {
  readonly fields: readonly FieldIssue[];

  constructor(fields: readonly FieldIssue[]) {
    super("The request is invalid.");
    this.name = "RequestValidationError";
    this.fields = Object.freeze([...fields]);
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && overBodyLimit(contentLength)) {
    throw new RequestValidationError([
      issue("body", "Request body is too large."),
    ]);
  }

  const text = await request.text();
  if (text.length === 0) {
    throw new RequestValidationError([
      issue("body", "Request body is required."),
    ]);
  }
  if (text.length > MAX_JSON_BODY_BYTES) {
    throw new RequestValidationError([
      issue("body", "Request body is too large."),
    ]);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestValidationError([
      issue("body", "Request body must be JSON."),
    ]);
  }
}

export function readObject(
  value: unknown,
  name = "body",
): FieldResult<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issue: issue(name, "Expected an object.") };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function readString(
  value: unknown,
  name: string,
  rules: StringRules = {},
): FieldResult<string> {
  const maxLength = rules.maxLength ?? DEFAULT_MAX_LENGTH;
  const minLength = rules.minLength ?? 1;
  if (typeof value !== "string") {
    return { ok: false, issue: issue(name, "Enter a value.") };
  }

  const text = rules.trim === true ? value.trim() : value;
  if (text.length === 0) {
    return { ok: false, issue: issue(name, "Enter a value.") };
  }
  if (text.length < minLength) {
    return {
      ok: false,
      issue: issue(name, `Use at least ${minLength} characters.`),
    };
  }
  if (text.length > maxLength) {
    return {
      ok: false,
      issue: issue(name, `Use at most ${maxLength} characters.`),
    };
  }
  if (rules.pattern !== undefined && !rules.pattern.test(text)) {
    return {
      ok: false,
      issue: issue(name, rules.patternMessage ?? "The value is invalid."),
    };
  }
  return { ok: true, value: text };
}

export function readOptionalString(
  value: unknown,
  name: string,
  rules: StringRules = {},
): FieldResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (
    typeof value === "string" &&
    (rules.trim === true ? value.trim() : value).length === 0
  ) {
    return { ok: true, value: null };
  }
  const result = readString(value, name, rules);
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: result.value };
}

export function readInteger(
  value: unknown,
  name: string,
  rules: IntegerRules = {},
): FieldResult<number> {
  const parsed = parseInteger(value);
  if (parsed === null) {
    return { ok: false, issue: issue(name, "Enter a whole number.") };
  }
  if (rules.min !== undefined && parsed < rules.min) {
    return {
      ok: false,
      issue: issue(name, `Use a whole number of at least ${rules.min}.`),
    };
  }
  if (rules.max !== undefined && parsed > rules.max) {
    return {
      ok: false,
      issue: issue(name, `Use a whole number of at most ${rules.max}.`),
    };
  }
  return { ok: true, value: parsed };
}

export function rejectInvalid(results: Array<FieldResult<unknown>>): void {
  const fields = results.flatMap((result) => (result.ok ? [] : [result.issue]));
  if (fields.length > 0) {
    throw new RequestValidationError(fields);
  }
}

function issue(name: string, message: string): FieldIssue {
  return {
    name: safeFieldName(name),
    message: safeFieldMessage(message),
  };
}

function safeFieldName(name: string): string {
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    return name;
  }
  return "field";
}

function safeFieldMessage(message: string): string {
  const cleaned = message.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (cleaned.length === 0) {
    return "The value is invalid.";
  }
  return cleaned.slice(0, 200);
}

function overBodyLimit(contentLength: string): boolean {
  if (!/^[0-9]+$/.test(contentLength)) {
    return false;
  }
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) && parsed > MAX_JSON_BODY_BYTES;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}
