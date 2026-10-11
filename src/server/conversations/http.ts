import "server-only";
import { ApiError, apiErrorCodes } from "../shared/api-error.ts";
import {
  ConversationNotActiveError,
  ConversationNotFoundError,
} from "./access.ts";
import { InvalidConversationTransition } from "./lifecycle.ts";

export function mapConversationError(error: unknown): Error {
  if (error instanceof ConversationNotFoundError) {
    return new ApiError(404, apiErrorCodes.notFound, "Not found.");
  }
  if (error instanceof ConversationNotActiveError) {
    return new ApiError(409, apiErrorCodes.conflict, error.message);
  }
  if (error instanceof InvalidConversationTransition) {
    return new ApiError(409, apiErrorCodes.conflict, error.message);
  }
  return error instanceof Error ? error : new Error("Unexpected server error");
}

export function jsonData(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
