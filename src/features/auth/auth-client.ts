const genericMessage = "Something went wrong. Try again.";

export type AuthUser = {
  id: string;
  phoneNumber: string;
  status: string;
};

export type AuthField = {
  name: string;
  message: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; message: string; fields: AuthField[] };

export function fieldMessage(
  fields: readonly AuthField[],
  name: string,
): string | undefined {
  return fields.find((field) => field.name === name)?.message;
}

export function formErrorsFromFailure(
  result: Extract<AuthResult, { ok: false }>,
): { phone?: string; password?: string; form?: string } {
  const phone = fieldMessage(result.fields, "phone");
  const password = fieldMessage(result.fields, "password");
  if (phone === undefined && password === undefined) {
    return { form: result.message };
  }
  return { phone, password };
}

export function authFailureFromPayload(payload: unknown): AuthResult {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { ok: false, message: genericMessage, fields: [] };
  }
  const message =
    typeof payload.error.message === "string" &&
    payload.error.message.length > 0
      ? payload.error.message
      : genericMessage;
  return { ok: false, message, fields: readFields(payload.error.fields) };
}

export async function postCredentials(
  path: "/api/v1/auth/login" | "/api/v1/auth/register",
  body: { phone: string; password: string },
): Promise<AuthResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        phone: body.phone,
        password: body.password,
      }),
    });
    const payload = await readPayload(response);
    if (response.ok) {
      if (!isRecord(payload) || !isUser(payload.user)) {
        return { ok: false, message: genericMessage, fields: [] };
      }
      return { ok: true, user: payload.user };
    }
    return authFailureFromPayload(payload);
  } catch {
    return { ok: false, message: genericMessage, fields: [] };
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readFields(value: unknown): AuthField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fields: AuthField[] = [];
  for (const item of value) {
    if (
      isRecord(item) &&
      typeof item.name === "string" &&
      typeof item.message === "string"
    ) {
      fields.push({ name: item.name, message: item.message });
    }
  }
  return fields;
}

function isUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.phoneNumber === "string" &&
    typeof value.status === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
