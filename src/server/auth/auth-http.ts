import "server-only";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { getPrismaClient } from "../database/prisma.ts";
import { getServerConfig } from "../config/env.ts";
import {
  ApiError,
  apiErrorCodes,
  handleApiRequest,
} from "../shared/api-error.ts";
import { assertSameOrigin } from "../shared/same-origin.ts";
import {
  InvalidPhoneNumberError,
  normalizePhoneNumber,
} from "../shared/phone-number.ts";
import {
  readJsonBody,
  readObject,
  readString,
  rejectInvalid,
  RequestValidationError,
} from "../shared/validate-request.ts";
import { currentUser } from "./current-user.ts";
import { InvalidCredentialsError, loginUser } from "./login-user.ts";
import { logoutUser } from "./logout-user.ts";
import { InvalidPasswordError, PASSWORD_MAX_LENGTH } from "./password.ts";
import type { PublicUser } from "./public-user.ts";
import {
  authRateLimiter,
  readClientIp,
  type AuthRateLimiter,
} from "./rate-limit.ts";
import { DuplicatePhoneError, registerUser } from "./register-user.ts";
import {
  clearedSessionCookie,
  readSessionCookie,
  sessionCookie,
} from "./session-cookie.ts";

export type AuthHttpDeps = {
  prisma: PrismaClient;
  sessionSecret: string;
  cookieName: string;
  maxAgeSeconds: number;
  secure: boolean;
  limiter: AuthRateLimiter;
  now: () => Date;
};

export function handleRegisterRequest(
  request: Request,
  deps: AuthHttpDeps = defaultAuthDeps(),
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertSameOrigin(request);
    const credentials = await readCredentials(request, deps, "register");
    try {
      const user = await registerUser(deps.prisma, credentials);
      return jsonUser(user, 201);
    } catch (error) {
      throw mapAuthError(error);
    }
  });
}

export function handleLoginRequest(
  request: Request,
  deps: AuthHttpDeps = defaultAuthDeps(),
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertSameOrigin(request);
    const credentials = await readCredentials(request, deps, "login");
    try {
      const result = await loginUser(deps.prisma, {
        ...credentials,
        sessionSecret: deps.sessionSecret,
        maxAgeSeconds: deps.maxAgeSeconds,
        now: deps.now(),
      });
      return jsonUser(
        result.user,
        200,
        sessionCookie({
          name: deps.cookieName,
          token: result.token,
          maxAgeSeconds: deps.maxAgeSeconds,
          secure: deps.secure,
        }),
      );
    } catch (error) {
      throw mapAuthError(error);
    }
  });
}

export function handleCurrentUserRequest(
  request: Request,
  deps: AuthHttpDeps = defaultAuthDeps(),
): Promise<Response> {
  return handleApiRequest(request, async () => {
    const user = await currentUser(deps.prisma, {
      token: readSessionCookie(request.headers.get("cookie"), deps.cookieName),
      sessionSecret: deps.sessionSecret,
      now: deps.now(),
    });
    if (user === null) {
      throw new ApiError(
        401,
        apiErrorCodes.unauthorized,
        "Sign in is required.",
      );
    }
    return jsonUser(user, 200);
  });
}

export function handleLogoutRequest(
  request: Request,
  deps: AuthHttpDeps = defaultAuthDeps(),
): Promise<Response> {
  return handleApiRequest(request, async () => {
    assertSameOrigin(request);
    const token = readSessionCookie(
      request.headers.get("cookie"),
      deps.cookieName,
    );
    await logoutUser(deps.prisma, {
      token,
      sessionSecret: deps.sessionSecret,
      now: deps.now(),
    });
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "set-cookie": clearedSessionCookie({
          name: deps.cookieName,
          secure: deps.secure,
        }),
      },
    });
  });
}

export function withCurrentUser(
  request: Request,
  run: (user: PublicUser, prisma: PrismaClient) => Promise<Response>,
  options?: { sameOrigin?: boolean },
): Promise<Response> {
  const deps = defaultAuthDeps();
  return handleApiRequest(request, async () => {
    if (options?.sameOrigin === true) {
      assertSameOrigin(request);
    }
    const user = await currentUser(deps.prisma, {
      token: readSessionCookie(request.headers.get("cookie"), deps.cookieName),
      sessionSecret: deps.sessionSecret,
      now: deps.now(),
    });
    if (user === null) {
      throw new ApiError(
        401,
        apiErrorCodes.unauthorized,
        "Sign in is required.",
      );
    }
    return run(user, deps.prisma);
  });
}

function defaultAuthDeps(): AuthHttpDeps {
  const config = getServerConfig();
  return {
    prisma: getPrismaClient(),
    sessionSecret: config.session.secret,
    cookieName: config.session.cookieName,
    maxAgeSeconds: config.session.maxAgeSeconds,
    secure: process.env.NODE_ENV === "production",
    limiter: authRateLimiter,
    now: () => new Date(),
  };
}

async function readCredentials(
  request: Request,
  deps: AuthHttpDeps,
  scope: "login" | "register",
): Promise<{ phone: string; password: string }> {
  const ip = readClientIp(request);
  deps.limiter.consume(scope, { ip, phone: null });

  const body = readObject(await readJsonBody(request));
  if (!body.ok) {
    throw new RequestValidationError([body.issue]);
  }
  const phone = readString(body.value.phone, "phone", {
    minLength: 8,
    maxLength: 32,
  });
  const password = readString(body.value.password, "password", {
    minLength: 1,
    maxLength: PASSWORD_MAX_LENGTH,
  });
  rejectInvalid([phone, password]);
  if (!phone.ok || !password.ok) {
    throw new RequestValidationError([
      { name: "body", message: "The request is invalid." },
    ]);
  }

  let canonical = "";
  try {
    canonical = normalizePhoneNumber(phone.value);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new RequestValidationError([
        { name: "phone", message: error.message },
      ]);
    }
    throw error;
  }
  deps.limiter.consume(scope, { ip: null, phone: canonical });
  return { phone: canonical, password: password.value };
}

function mapAuthError(error: unknown): Error {
  if (error instanceof InvalidPhoneNumberError) {
    return new RequestValidationError([
      { name: "phone", message: error.message },
    ]);
  }
  if (error instanceof InvalidPasswordError) {
    return new RequestValidationError([
      { name: "password", message: error.message },
    ]);
  }
  if (error instanceof DuplicatePhoneError) {
    return new ApiError(409, apiErrorCodes.conflict, error.message);
  }
  if (error instanceof InvalidCredentialsError) {
    return new ApiError(401, apiErrorCodes.unauthorized, error.message);
  }
  return error instanceof Error ? error : new Error("Unexpected server error");
}

function jsonUser(user: PublicUser, status: number, cookie?: string): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (cookie !== undefined) {
    headers.set("set-cookie", cookie);
  }
  return Response.json({ user }, { status, headers });
}
