import "server-only";
import { getServerConfig } from "../config/env.ts";
import { getPrismaClient } from "../database/prisma.ts";
import { InvalidMessageError } from "../database/conversations.ts";
import { assertServiceCredential } from "../integrations/service-auth.ts";
import { handleApiRequest } from "../shared/api-error.ts";
import {
  readJsonBody,
  readObject,
  readOptionalString,
  readString,
  rejectInvalid,
  RequestValidationError,
} from "../shared/validate-request.ts";
import { conversationId } from "./access.ts";
import { authorizeVoiceSession } from "./authorize-voice-session.ts";
import { jsonData, mapConversationError } from "./http.ts";
import { ingestTranscript } from "./ingest-transcript.ts";

const MESSAGE_MAX_LENGTH = 8_000;

export function handleAuthorizeVoiceSession(
  request: Request,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    try {
      const body = await readBody(request);
      const id = readString(body.conversationId, "conversationId", {
        minLength: 36,
        maxLength: 36,
      });
      const roomName = readString(body.roomName, "roomName", {
        minLength: 1,
        maxLength: 64,
      });
      const claimed = readOptionalString(body.userId, "userId", {
        minLength: 36,
        maxLength: 36,
      });
      rejectInvalid([id, roomName, claimed]);
      if (!id.ok || !roomName.ok || !claimed.ok) {
        throw new RequestValidationError([
          { name: "body", message: "The request is invalid." },
        ]);
      }
      const session = await authorizeVoiceSession(getPrismaClient(), {
        conversationId: conversationId(id.value),
        roomName: roomName.value,
        claimedUserId: claimed.value,
      });
      return jsonData({
        conversationId: session.conversationId,
        userId: session.userId,
        roomName: session.roomName,
      });
    } catch (error) {
      throw mapConversationError(error);
    }
  });
}

export function handleIngestTranscript(
  request: Request,
  conversation: string,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    try {
      const body = await readBody(request);
      const userId = readString(body.userId, "userId", {
        minLength: 36,
        maxLength: 36,
      });
      const role = readString(body.role, "role", {
        pattern: /^(user|assistant)$/,
        patternMessage: "Use user or assistant.",
      });
      const content = readString(body.content, "content", {
        minLength: 1,
        maxLength: MESSAGE_MAX_LENGTH,
      });
      const eventId = readOptionalString(body.eventId, "eventId", {
        minLength: 1,
        maxLength: 128,
      });
      const createdAt = readOptionalString(body.createdAt, "createdAt", {
        minLength: 1,
        maxLength: 40,
      });
      rejectInvalid([userId, role, content, eventId, createdAt]);
      if (
        !userId.ok ||
        !role.ok ||
        !content.ok ||
        !eventId.ok ||
        !createdAt.ok
      ) {
        throw new RequestValidationError([
          { name: "body", message: "The request is invalid." },
        ]);
      }
      const timestamp = parseTimestamp(createdAt.value);
      const saved = await ingestTranscript(getPrismaClient(), {
        conversationId: conversationId(conversation),
        userId: conversationId(userId.value),
        role: role.value === "assistant" ? "assistant" : "user",
        content: content.value,
        eventId: eventId.value,
        createdAt: timestamp,
      });
      return jsonData(
        {
          message: saved.message,
        },
        saved.created ? 201 : 200,
      );
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        throw new RequestValidationError([
          { name: "content", message: "The message is invalid." },
        ]);
      }
      throw mapConversationError(error);
    }
  });
}

function serviceTokens(): { current: string; previous: string | null } {
  const config = getServerConfig().internalService;
  return { current: config.token, previous: config.previousToken };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = readObject(await readJsonBody(request));
  if (!body.ok) {
    throw new RequestValidationError([body.issue]);
  }
  return body.value;
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) {
    throw new RequestValidationError([
      { name: "createdAt", message: "Use an ISO timestamp." },
    ]);
  }
  return createdAt;
}
