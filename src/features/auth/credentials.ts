// Format hints only. Register and login APIs make the final decision.
const PHONE_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

const phoneMessage = "Enter a valid phone number with a country code.";
const passwordRequiredMessage = "Enter a password.";

export type CredentialIssues = {
  phone?: string;
  password?: string;
};

export function credentialIssues(
  phone: string,
  password: string,
): CredentialIssues {
  const issues: CredentialIssues = {};
  const phoneIssue = phoneIssueFor(phone, true);
  const passwordIssue = passwordIssueFor(password, true);
  if (phoneIssue !== undefined) {
    issues.phone = phoneIssue;
  }
  if (passwordIssue !== undefined) {
    issues.password = passwordIssue;
  }
  return issues;
}

export function hasCredentialIssues(issues: CredentialIssues): boolean {
  return issues.phone !== undefined || issues.password !== undefined;
}

export function livePhoneIssue(phone: string): string | undefined {
  return phoneIssueFor(phone, false);
}

export function livePasswordIssue(password: string): string | undefined {
  return passwordIssueFor(password, false);
}

function phoneIssueFor(phone: string, required: boolean): string | undefined {
  const trimmed = phone.trim();
  if (trimmed.length === 0) {
    return required ? phoneMessage : undefined;
  }
  if (trimmed.length > PHONE_MAX_LENGTH || !isInternationalPhone(trimmed)) {
    return phoneMessage;
  }
  return undefined;
}

function passwordIssueFor(
  password: string,
  required: boolean,
): string | undefined {
  if (password.length === 0) {
    return required ? passwordRequiredMessage : undefined;
  }
  if (password.includes("\u0000")) {
    return passwordRequiredMessage;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return undefined;
}

function isInternationalPhone(input: string): boolean {
  const stripped = input.replace(/[ \u00A0().-]/g, "");
  const international = stripped.startsWith("00")
    ? `+${stripped.slice(2)}`
    : stripped;
  return /^\+[1-9]\d{7,14}$/.test(international);
}
