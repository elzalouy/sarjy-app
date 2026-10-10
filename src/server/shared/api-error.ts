import "server-only";
import { logRequest, readRequestId, REQUEST_ID_HEADER } from "./request-log";
import { RequestValidationError } from "./validate-request";

export const apiErrorCodes = {
  validationError: "validation_error",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
  conflict: "conflict",
  internalError: "internal_error",
} as const;

const clientErrors = {
  unauthorized: {
    status: 401,
    code: apiErrorCodes.unauthorized,
    message: "Sign in is required.",
  },
  forbidden: {
    status: 403,
    code: apiErrorCodes.forbidden,
    message: "You do not have access.",
  },
  notFound: {
    status: 404,
    code: apiErrorCodes.notFound,
    message: "Not found.",
  },
  conflict: {
    status: 409,
    code: apiErrorCodes.conflict,
    message: "That request conflicts with existing data.",
  },
} as const;

const validationMessage = "The request is invalid.";
const internalMessage = "Something went wrong. Try again.";

export class ApiError extends Error {
  readonly status: 401 | 403 | 404 | 409;
  readonly code: string;
  readonly clientMessage: string;

  constructor(
    status: 401 | 403 | 404 | 409,
    code: string,
    clientMessage: string,
  ) {
    super(clientMessage);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.clientMessage = clientMessage;
  }
}

export function clientError(kind: keyof typeof clientErrors): ApiError {
  const item = clientErrors[kind];
  return new ApiError(item.status, item.code, item.message);
}

export async function handleApiRequest(
  request: Request,
  run: () => Promise<Response>,
  write?: (line: string) => void,
): Promise<Response> {
  const started = Date.now();
  const requestId = readRequestId(request.headers.get(REQUEST_ID_HEADER));
  const method = request.method;
  const route = requestPath(request);

  try {
    const response = await run();
    logRequest(
      {
        requestId,
        method,
        route,
        status: response.status,
        durationMs: Date.now() - started,
      },
      write,
    );
    return withRequestId(response, requestId);
  } catch (error) {
    const response = toErrorResponse(error, requestId);
    logRequest(
      {
        requestId,
        method,
        route,
        status: response.status,
        durationMs: Date.now() - started,
        error: errorForLog(error),
      },
      write,
    );
    return response;
  }
}

function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof RequestValidationError) {
    return jsonError({
      status: 400,
      code: apiErrorCodes.validationError,
      message: validationMessage,
      requestId,
      fields: error.fields.map((field) => ({
        name: field.name,
        message: field.message,
      })),
    });
  }
  if (error instanceof ApiError) {
    return jsonError({
      status: error.status,
      code: error.code,
      message: error.clientMessage,
      requestId,
    });
  }
  return jsonError({
    status: 500,
    code: apiErrorCodes.internalError,
    message: internalMessage,
    requestId,
  });
}

function errorForLog(error: unknown): unknown {
  if (error instanceof RequestValidationError) {
    const names = error.fields.map((field) => field.name).join(", ");
    return new Error(`${validationMessage} Fields: ${names}.`);
  }
  return error;
}

function jsonError(input: {
  status: number;
  code: string;
  message: string;
  requestId: string;
  fields?: Array<{ name: string; message: string }>;
}): Response {
  const error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ name: string; message: string }>;
  } = {
    code: input.code,
    message: input.message,
    requestId: input.requestId,
  };
  if (input.fields !== undefined && input.fields.length > 0) {
    error.fields = input.fields;
  }
  return Response.json(
    { error },
    {
      status: input.status,
      headers: {
        "cache-control": "no-store",
        [REQUEST_ID_HEADER]: input.requestId,
      },
    },
  );
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}
