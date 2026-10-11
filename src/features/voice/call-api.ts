const genericStart = "Could not start the call.";
const genericEnd = "The call ended, but the server did not confirm it.";

export async function createConversation(): Promise<{ id: string }> {
  const response = await fetch("/api/v1/conversations", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, genericStart));
  }
  if (!isRecord(body) || typeof body.id !== "string" || body.id.length === 0) {
    throw new Error(genericStart);
  }
  return { id: body.id };
}

export async function requestLiveKitToken(
  conversationId: string,
): Promise<{ token: string; url: string }> {
  const response = await fetch(
    `/api/v1/conversations/${conversationId}/livekit-token`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, genericStart));
  }
  if (
    !isRecord(body) ||
    typeof body.token !== "string" ||
    body.token.length === 0 ||
    typeof body.url !== "string" ||
    body.url.length === 0
  ) {
    throw new Error(genericStart);
  }
  return { token: body.token, url: body.url };
}

export async function endConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/v1/conversations/${conversationId}/end`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(genericEnd);
  }
}

async function readJson(response: Response): Promise<unknown> {
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

function errorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || !isRecord(body.error)) {
    return fallback;
  }
  const message = body.error.message;
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 160
  ) {
    return fallback;
  }
  if (message.includes("eyJ")) {
    return fallback;
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
