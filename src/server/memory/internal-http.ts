import "server-only";
import { getServerConfig } from "../config/env.ts";
import { InvalidMemoryError } from "../database/memories.ts";
import { getPrismaClient } from "../database/prisma.ts";
import { findUserById } from "../database/users.ts";
import { assertServiceCredential } from "../integrations/service-auth.ts";
import {
  ApiError,
  apiErrorCodes,
  handleApiRequest,
} from "../shared/api-error.ts";
import {
  readJsonBody,
  readObject,
  readString,
  rejectInvalid,
  RequestValidationError,
} from "../shared/validate-request.ts";
import {
  correctMemoryForUser,
  forgetMemoryForUser,
  listMemoryForUser,
  rememberMemoryForUser,
} from "./memory-service.ts";
import { MemoryRejectedError } from "./policy.ts";

const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALUE_MAX_LENGTH = 80;

export function handleListMemory(
  request: Request,
  userId: string,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    const ownerId = await requireUser(userId);
    const memories = await listMemoryForUser(getPrismaClient(), ownerId);
    return jsonData({ memories });
  });
}

export function handleRememberMemory(
  request: Request,
  userId: string,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    try {
      const ownerId = await requireUser(userId);
      const body = await readBody(request);
      const memory = await rememberMemoryForUser(getPrismaClient(), {
        userId: ownerId,
        ...readMemoryWrite(body),
      });
      return jsonData({ memory });
    } catch (error) {
      throw mapMemoryError(error);
    }
  });
}

export function handleCorrectMemory(
  request: Request,
  userId: string,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    try {
      const ownerId = await requireUser(userId);
      const body = await readBody(request);
      const memory = await correctMemoryForUser(getPrismaClient(), {
        userId: ownerId,
        ...readMemoryWrite(body),
      });
      return jsonData({ memory });
    } catch (error) {
      throw mapMemoryError(error);
    }
  });
}

export function handleForgetMemory(
  request: Request,
  userId: string,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertServiceCredential(request, serviceTokens());
    try {
      const ownerId = await requireUser(userId);
      const body = await readBody(request);
      const deleted = await forgetMemoryForUser(getPrismaClient(), {
        userId: ownerId,
        ...readMemoryRemoval(body),
      });
      return jsonData({ deleted });
    } catch (error) {
      throw mapMemoryError(error);
    }
  });
}

async function requireUser(userId: string): Promise<string> {
  if (!USER_ID.test(userId)) {
    throw new ApiError(404, apiErrorCodes.notFound, "Not found.");
  }
  const user = await findUserById(getPrismaClient(), userId);
  if (user === null) {
    throw new ApiError(404, apiErrorCodes.notFound, "Not found.");
  }
  return user.id;
}

function readMemoryWrite(body: Record<string, unknown>): {
  key: string;
  value: string;
  source: string;
  approved: boolean;
} {
  const key = readString(body.key, "key", { minLength: 1, maxLength: 64 });
  const value = readString(body.value, "value", {
    minLength: 1,
    maxLength: VALUE_MAX_LENGTH,
  });
  const source = readSource(body.source);
  const approved = readBoolean(body.approved, "approved");
  rejectInvalid([key, value, source, approved]);
  if (!key.ok || !value.ok || !source.ok || !approved.ok) {
    throw new RequestValidationError([
      { name: "body", message: "The request is invalid." },
    ]);
  }
  return {
    key: key.value,
    value: value.value,
    source: source.value,
    approved: approved.value,
  };
}

function readMemoryRemoval(body: Record<string, unknown>): {
  key: string;
  source: string;
  approved: boolean;
} {
  const key = readString(body.key, "key", { minLength: 1, maxLength: 64 });
  const source = readSource(body.source);
  const approved = readBoolean(body.approved, "approved");
  rejectInvalid([key, source, approved]);
  if (!key.ok || !source.ok || !approved.ok) {
    throw new RequestValidationError([
      { name: "body", message: "The request is invalid." },
    ]);
  }
  return {
    key: key.value,
    source: source.value,
    approved: approved.value,
  };
}

function readSource(value: unknown) {
  return readString(value, "source", {
    pattern: /^(user|extracted)$/,
    patternMessage: "Use user or extracted.",
  });
}

function readBoolean(
  value: unknown,
  name: string,
):
  | { ok: true; value: boolean }
  | { ok: false; issue: { name: string; message: string } } {
  if (typeof value !== "boolean") {
    return { ok: false, issue: { name, message: "Use true or false." } };
  }
  return { ok: true, value };
}

function mapMemoryError(error: unknown): Error {
  if (error instanceof MemoryRejectedError) {
    if (error.reason === "missing") {
      return new ApiError(404, apiErrorCodes.notFound, error.message);
    }
    const field = error.reason === "approval_required" ? "approved" : "value";
    return new RequestValidationError([
      { name: field, message: error.message },
    ]);
  }
  if (error instanceof InvalidMemoryError) {
    return new ApiError(404, apiErrorCodes.notFound, "Not found.");
  }
  if (error instanceof ApiError || error instanceof RequestValidationError) {
    return error;
  }
  return error instanceof Error ? error : new Error("Unexpected server error");
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

function jsonData(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
