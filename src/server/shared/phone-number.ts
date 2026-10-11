import "server-only";

const MAX_INPUT_LENGTH = 32;

/**
 * Canonical form is E.164: a leading + and 8 to 15 digits, such as +14155552671.
 * That value fits users.phone_number.
 *
 * Accepted input:
 * - A leading + and the country code
 * - A leading 00 instead of +
 * - Spaces, dots, hyphens, and parentheses
 *
 * A national number with no country code is rejected.
 */
export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("Enter a valid phone number with a country code.");
    this.name = "InvalidPhoneNumberError";
  }
}

export function normalizePhoneNumber(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidPhoneNumberError();
  }

  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
    throw new InvalidPhoneNumberError();
  }

  const stripped = trimmed.replace(/[ \u00A0().-]/g, "");
  const international = stripped.startsWith("00")
    ? `+${stripped.slice(2)}`
    : stripped;

  if (!/^\+[1-9]\d{7,14}$/.test(international)) {
    throw new InvalidPhoneNumberError();
  }

  return international;
}
