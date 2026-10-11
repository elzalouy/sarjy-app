import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export {}",
        shortCircuit: true,
      };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !specifier.endsWith(".ts") &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { hashPassword } = await import("../src/server/auth/password.ts");
const { DuplicatePhoneError, registerUser } =
  await import("../src/server/auth/register-user.ts");
const { InvalidCredentialsError, loginUser } =
  await import("../src/server/auth/login-user.ts");
const { clearedSessionCookie, readSessionCookie, sessionCookie } =
  await import("../src/server/auth/session-cookie.ts");
const { sessionAccess } = await import("../src/server/auth/session-token.ts");
const { createAuthRateLimiter } =
  await import("../src/server/auth/rate-limit.ts");
const { handleLoginRequest, handleRegisterRequest } =
  await import("../src/server/auth/auth-http.ts");
const { POST: loginPost } =
  await import("../src/app/api/v1/auth/login/route.ts");
const { POST: registerPost } =
  await import("../src/app/api/v1/auth/register/route.ts");
const { GET: meGet } = await import("../src/app/api/v1/auth/me/route.ts");
const { POST: logoutPost } =
  await import("../src/app/api/v1/auth/logout/route.ts");
const { readSessionUser } =
  await import("../src/server/auth/read-session-user.ts");
const { createPrismaClient } = await import("../src/server/database/prisma.ts");

const root = path.resolve(import.meta.dirname, "..");
const sessionSecret = "test-session-secret-with-32-characters";
const password = "correct-horse-secret";
const now = new Date("2026-10-10T12:00:00.000Z");

test("session expiry and revocation reject the session", () => {
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 60_000);

  assert.equal(
    sessionAccess(
      { expiresAt: future, revokedAt: null, status: "active" },
      now,
    ),
    "valid",
  );
  assert.equal(
    sessionAccess({ expiresAt: past, revokedAt: null, status: "active" }, now),
    "rejected",
  );
  assert.equal(
    sessionAccess({ expiresAt: future, revokedAt: now, status: "active" }, now),
    "rejected",
  );
  assert.equal(
    sessionAccess(
      { expiresAt: future, revokedAt: null, status: "disabled" },
      now,
    ),
    "rejected",
  );
});

test("the session cookie is HttpOnly and matches the session lifetime", () => {
  const cookie = sessionCookie({
    name: "sarjy_session",
    token: "token-value",
    maxAgeSeconds: 3600,
    secure: true,
  });

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
  assert.equal(readSessionCookie(cookie, "sarjy_session"), "token-value");
  assert.equal(
    readSessionCookie(
      clearedSessionCookie({ name: "sarjy_session", secure: true }),
      "sarjy_session",
    ),
    null,
  );
  assert.match(
    clearedSessionCookie({ name: "sarjy_session", secure: false }),
    /Max-Age=0/,
  );
  assert.doesNotMatch(
    sessionCookie({
      name: "sarjy_session",
      token: "token-value",
      maxAgeSeconds: 3600,
      secure: false,
    }),
    /Secure/,
  );
});

test("the session migration links sessions to users", async () => {
  const schema = await readFile(
    path.join(root, "prisma/schema.prisma"),
    "utf8",
  );
  const migrationDir = path.join(root, "prisma/migrations");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(migrationDir);
  const sessionMigration = entries.find((entry) =>
    entry.endsWith("_add_session"),
  );
  assert.ok(sessionMigration);
  const sql = await readFile(
    path.join(migrationDir, sessionMigration, "migration.sql"),
    "utf8",
  );

  assert.match(schema, /model Session \{/);
  assert.match(schema, /revokedAt\s+DateTime\?/);
  assert.match(sql, /CREATE UNIQUE INDEX "sessions_token_hash_key"/);
  assert.match(sql, /CREATE INDEX "sessions_user_id_idx"/);
  assert.match(sql, /CREATE INDEX "sessions_expires_at_idx"/);
  assert.match(sql, /CREATE INDEX "sessions_revoked_at_idx"/);
  assert.match(
    sql,
    /FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/,
  );
});

test("registration stores a hash and rejects a duplicate phone", async () => {
  const rows: Array<{ phoneNumber: string; passwordHash: string }> = [];
  const prisma = {
    user: {
      create: async (args: {
        data: { phoneNumber: string; passwordHash: string };
      }) => {
        if (rows.some((row) => row.phoneNumber === args.data.phoneNumber)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        rows.push(args.data);
        return {
          id: "11111111-1111-4111-8111-111111111111",
          phoneNumber: args.data.phoneNumber,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        };
      },
    },
  };

  const user = await registerUser(prisma as never, {
    phone: "+1 (415) 555-2671",
    password,
  });

  assert.equal(user.phoneNumber, "+14155552671");
  assert.equal("passwordHash" in user, false);
  assert.equal(rows[0]?.phoneNumber, "+14155552671");
  assert.notEqual(rows[0]?.passwordHash, password);
  assert.match(rows[0]?.passwordHash ?? "", /^\$argon2id\$/);
  await assert.rejects(
    () =>
      registerUser(prisma as never, {
        phone: "0014155552671",
        password,
      }),
    DuplicatePhoneError,
  );
});

test("login accepts the password and hides whether the phone is registered", async () => {
  const passwordHash = await hashPassword(password);
  const sessions: Array<{
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }> = [];
  const users = new Map<
    string,
    {
      id: string;
      phoneNumber: string;
      status: "active" | "disabled";
      passwordHash: string;
      createdAt: Date;
      updatedAt: Date;
    }
  >([
    [
      "+14155552671",
      {
        id: "11111111-1111-4111-8111-111111111111",
        phoneNumber: "+14155552671",
        status: "active",
        passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    ],
  ]);
  const prisma = {
    user: {
      findUnique: async (args: { where: { phoneNumber: string } }) =>
        users.get(args.where.phoneNumber) ?? null,
    },
    session: {
      create: async (args: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) => {
        sessions.push(args.data);
      },
    },
  };

  const result = await loginUser(prisma as never, {
    phone: "+1 415 555 2671",
    password,
    sessionSecret,
    maxAgeSeconds: 3600,
    now,
  });

  assert.equal(result.user.phoneNumber, "+14155552671");
  assert.equal("passwordHash" in result.user, false);
  assert.equal(result.token.includes(password), false);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.userId, result.user.id);
  assert.notEqual(sessions[0]?.tokenHash, result.token);
  assert.equal(sessions[0]?.tokenHash.length, 64);
  assert.equal(
    sessions[0]?.expiresAt.toISOString(),
    new Date(now.getTime() + 3600 * 1000).toISOString(),
  );

  const wrongPassword = await loginFailure(
    prisma as never,
    "+14155552671",
    "wrong-horse-secret",
  );
  const unknownPhone = await loginFailure(
    prisma as never,
    "+14155552672",
    password,
  );
  assert.ok(wrongPassword instanceof InvalidCredentialsError);
  assert.ok(unknownPhone instanceof InvalidCredentialsError);
  assert.equal(wrongPassword.message, unknownPhone.message);
  assert.equal(wrongPassword.message.includes(password), false);
  assert.equal(sessions.length, 1);

  users.set("+14155552673", {
    id: "22222222-2222-4222-8222-222222222222",
    phoneNumber: "+14155552673",
    status: "disabled",
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  const before = sessions.length;
  await assert.rejects(
    () =>
      loginUser(prisma as never, {
        phone: "+14155552673",
        password,
        sessionSecret,
        maxAgeSeconds: 3600,
        now,
      }),
    InvalidCredentialsError,
  );
  assert.equal(sessions.length, before);
});

test("auth rate limits are the same for known and unknown phones", async () => {
  const current = 0;
  const limiter = createAuthRateLimiter({
    phoneLimit: 1,
    ipLimit: 2,
    windowMs: 60_000,
    now: () => current,
  });
  const passwordHash = await hashPassword(password);
  const prisma = {
    user: {
      findUnique: async (args: { where: { phoneNumber: string } }) => {
        if (args.where.phoneNumber === "+14155552671") {
          return {
            id: "11111111-1111-4111-8111-111111111111",
            phoneNumber: "+14155552671",
            status: "active" as const,
            passwordHash,
            createdAt: now,
            updatedAt: now,
          };
        }
        return null;
      },
      create: async () => {
        throw new Error("register should not run when limited");
      },
    },
    session: {
      create: async () => {
        throw new Error("login should not create a session");
      },
    },
  };
  const deps = {
    prisma: prisma as never,
    sessionSecret,
    cookieName: "sarjy_session",
    maxAgeSeconds: 3600,
    secure: true,
    limiter,
    now: () => now,
  };

  const known = await handleLoginRequest(loginRequest("+14155552671"), deps);
  const unknown = await handleLoginRequest(loginRequest("+14155559999"), deps);
  const knownAgain = await handleLoginRequest(
    loginRequest("+14155552671"),
    deps,
  );
  const unknownAgain = await handleLoginRequest(
    loginRequest("+14155559999"),
    deps,
  );
  const knownBody = (await known.json()) as ErrorBody;
  const unknownBody = (await unknown.json()) as ErrorBody;
  const knownLimited = (await knownAgain.json()) as ErrorBody;
  const unknownLimited = (await unknownAgain.json()) as ErrorBody;

  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(knownBody.error.code, unknownBody.error.code);
  assert.equal(knownBody.error.message, unknownBody.error.message);
  assert.equal(knownAgain.status, 429);
  assert.equal(unknownAgain.status, 429);
  assert.equal(knownLimited.error.code, "too_many_requests");
  assert.equal(knownLimited.error.message, unknownLimited.error.message);
  assert.equal(knownLimited.error.message.includes("+14155552671"), false);
  assert.equal(knownLimited.error.message.includes("registered"), false);
  assert.equal(knownAgain.headers.get("retry-after") !== null, true);

  const rotating = createAuthRateLimiter({
    phoneLimit: 10,
    ipLimit: 2,
    windowMs: 60_000,
    now: () => current,
  });
  const ipDeps = { ...deps, limiter: rotating };
  assert.equal(
    (
      await handleLoginRequest(
        loginRequest("+14155551001", "203.0.113.5"),
        ipDeps,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleLoginRequest(
        loginRequest("+14155551002", "203.0.113.5"),
        ipDeps,
      )
    ).status,
    401,
  );
  const ipLimited = await handleLoginRequest(
    loginRequest("+14155551003", "203.0.113.5"),
    ipDeps,
  );
  assert.equal(ipLimited.status, 429);

  const registerLimiter = createAuthRateLimiter({
    phoneLimit: 1,
    ipLimit: 10,
    windowMs: 60_000,
    now: () => current,
  });
  let created = 0;
  const registerDeps = {
    ...deps,
    limiter: registerLimiter,
    prisma: {
      user: {
        create: async () => {
          created += 1;
          return {
            id: "33333333-3333-4333-8333-333333333333",
            phoneNumber: "+14155552680",
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
          };
        },
      },
    } as never,
  };
  const firstRegister = await handleRegisterRequest(
    jsonRequest("/api/v1/auth/register", {
      phone: "+14155552680",
      password,
    }),
    registerDeps,
  );
  const secondRegister = await handleRegisterRequest(
    jsonRequest("/api/v1/auth/register", {
      phone: "0014155552680",
      password,
    }),
    registerDeps,
  );
  const secondBody = (await secondRegister.json()) as ErrorBody;
  assert.equal(firstRegister.status, 201);
  assert.equal(created, 1);
  assert.equal(secondRegister.status, 429);
  assert.equal(secondBody.error.code, "too_many_requests");
  assert.equal(secondBody.error.message, knownLimited.error.message);
  assert.equal(secondBody.error.message.includes("+14155552680"), false);
});

test("a cross-site login is blocked before a session is created", async () => {
  let queries = 0;
  const deps = {
    prisma: {
      user: {
        findUnique: async () => {
          queries += 1;
          return null;
        },
      },
    } as never,
    sessionSecret,
    cookieName: "sarjy_session",
    maxAgeSeconds: 3600,
    secure: true,
    limiter: createAuthRateLimiter({
      phoneLimit: 5,
      ipLimit: 20,
      windowMs: 60_000,
    }),
    now: () => now,
  };
  const request = loginRequest("+14155552671");
  request.headers.set("origin", "https://evil.example");

  const response = await handleLoginRequest(request, deps);
  const body = (await response.json()) as ErrorBody;

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "forbidden");
  assert.equal(queries, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("login from the browser host is allowed when the internal URL differs", async () => {
  let queries = 0;
  const deps = {
    prisma: {
      user: {
        findUnique: async () => {
          queries += 1;
          return null;
        },
      },
    } as never,
    sessionSecret,
    cookieName: "sarjy_session",
    maxAgeSeconds: 3600,
    secure: false,
    limiter: createAuthRateLimiter({
      phoneLimit: 5,
      ipLimit: 20,
      windowMs: 60_000,
    }),
    now: () => now,
  };
  const request = new Request("http://localhost:3000/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "192.168.1.15:3000",
      origin: "http://192.168.1.15:3000",
    },
    body: JSON.stringify({
      phone: "+14155552671",
      password: "wrong-horse-secret",
    }),
  });

  const response = await handleLoginRequest(request, deps);
  const body = (await response.json()) as ErrorBody;

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "unauthorized");
  assert.equal(queries, 1);
});

test("register, login, current user, and logout work over HTTP", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    t.skip("DATABASE_URL is not set.");
    return;
  }
  const prisma = createPrismaClient(databaseUrl);
  const phone = testPhone();
  try {
    const anonymous = await meGet(
      new Request("http://127.0.0.1/api/v1/auth/me"),
    );
    const anonymousBody = (await anonymous.json()) as ErrorBody;
    assert.equal(anonymous.status, 401);
    assert.equal(anonymousBody.error.code, "unauthorized");
    assert.equal(await readSessionUser(null), null);

    const registered = await registerPost(
      jsonRequest("/api/v1/auth/register", {
        phone: formatPhone(phone),
        password,
      }),
    );
    const registeredBody = (await registered.json()) as { user: PublicBody };
    assert.equal(registered.status, 201);
    assert.equal(registeredBody.user.phoneNumber, phone);
    assert.equal(registeredBody.user.status, "active");
    assert.equal(JSON.stringify(registeredBody).includes(password), false);
    assert.equal(
      JSON.stringify(registeredBody).includes("passwordHash"),
      false,
    );

    const duplicate = await registerPost(
      jsonRequest("/api/v1/auth/register", {
        phone,
        password,
      }),
    );
    const duplicateBody = (await duplicate.json()) as ErrorBody;
    assert.equal(duplicate.status, 409);
    assert.equal(duplicateBody.error.code, "conflict");
    assert.equal(duplicateBody.error.message.includes(phone), false);
    assert.equal(duplicateBody.error.message.includes(password), false);

    const loggedIn = await loginPost(
      jsonRequest("/api/v1/auth/login", {
        phone: formatPhone(phone),
        password,
      }),
    );
    const loggedInBody = (await loggedIn.json()) as { user: PublicBody };
    const cookieName =
      process.env.SESSION_COOKIE_NAME?.trim() || "sarjy_session";
    const setCookie = loggedIn.headers.get("set-cookie") ?? "";
    const token = readSessionCookie(setCookie, cookieName);
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedInBody.user.id, registeredBody.user.id);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Max-Age=/);
    if (process.env.NODE_ENV !== "production") {
      assert.equal(setCookie.includes("Secure"), false);
    }
    assert.ok(token);
    assert.equal(JSON.stringify(loggedInBody).includes(token), false);
    assert.equal(JSON.stringify(loggedInBody).includes(password), false);

    const session = await prisma.session.findFirst({
      where: { userId: registeredBody.user.id },
    });
    assert.ok(session);
    assert.equal(session.userId, registeredBody.user.id);
    assert.notEqual(session.tokenHash, token);
    assert.equal(session.revokedAt, null);

    const me = await meGet(cookieRequest("/api/v1/auth/me", token, cookieName));
    const meBody = (await me.json()) as { user: PublicBody };
    assert.equal(me.status, 200);
    assert.deepEqual(meBody.user, loggedInBody.user);
    assert.equal(JSON.stringify(meBody).includes("passwordHash"), false);

    const loggedOut = await logoutPost(
      cookieRequest("/api/v1/auth/logout", token, cookieName, "POST"),
    );
    assert.equal(loggedOut.status, 204);
    assert.match(loggedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
    const afterLogout = await prisma.session.findUnique({
      where: { id: session.id },
    });
    assert.ok(afterLogout?.revokedAt);

    const meAfter = await meGet(
      cookieRequest("/api/v1/auth/me", token, cookieName),
    );
    assert.equal(meAfter.status, 401);

    const wrong = await loginPost(
      jsonRequest("/api/v1/auth/login", {
        phone,
        password: "wrong-horse-secret",
      }),
    );
    const unknown = await loginPost(
      jsonRequest("/api/v1/auth/login", {
        phone: testPhone(),
        password,
      }),
    );
    const wrongBody = (await wrong.json()) as ErrorBody;
    const unknownBody = (await unknown.json()) as ErrorBody;
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrongBody.error.message, unknownBody.error.message);
    assert.equal(wrongBody.error.message.includes(password), false);

    await prisma.session.updateMany({
      where: { userId: registeredBody.user.id },
      data: { revokedAt: null, expiresAt: new Date(Date.now() - 60_000) },
    });
    const freshLogin = await loginPost(
      jsonRequest("/api/v1/auth/login", {
        phone,
        password,
      }),
    );
    const freshCookie = freshLogin.headers.get("set-cookie") ?? "";
    const freshToken = readSessionCookie(freshCookie, cookieName);
    assert.ok(freshToken);
    await prisma.session.updateMany({
      where: { userId: registeredBody.user.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await meGet(
      cookieRequest("/api/v1/auth/me", freshToken, cookieName),
    );
    assert.equal(expired.status, 401);
    assert.equal(await readSessionUser(freshToken), null);

    const revokedLogin = await loginPost(
      jsonRequest("/api/v1/auth/login", {
        phone,
        password,
      }),
    );
    const revokedToken = readSessionCookie(
      revokedLogin.headers.get("set-cookie") ?? "",
      cookieName,
    );
    assert.ok(revokedToken);
    await prisma.session.updateMany({
      where: { userId: registeredBody.user.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const revoked = await meGet(
      cookieRequest("/api/v1/auth/me", revokedToken, cookieName),
    );
    assert.equal(revoked.status, 401);
    assert.equal(await readSessionUser(revokedToken), null);
  } finally {
    await prisma.user.deleteMany({ where: { phoneNumber: phone } });
    await prisma.$disconnect();
  }
});

test("login logs and responses omit the password", async () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const response = await handleLoginRequest(
      loginRequest("+14155552671", null, "not-the-password"),
      {
        prisma: {
          user: { findUnique: async () => null },
          session: { create: async () => undefined },
        } as never,
        sessionSecret,
        cookieName: "sarjy_session",
        maxAgeSeconds: 3600,
        secure: false,
        limiter: createAuthRateLimiter({
          phoneLimit: 5,
          ipLimit: 20,
          windowMs: 60_000,
        }),
        now: () => now,
      },
    );
    const body = await response.text();
    assert.equal(body.includes("not-the-password"), false);
    assert.equal(lines.join("\n").includes("not-the-password"), false);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

type ErrorBody = {
  error: { code: string; message: string };
};

type PublicBody = {
  id: string;
  phoneNumber: string;
  status: string;
};

async function loginFailure(
  prisma: never,
  phone: string,
  secret: string,
): Promise<unknown> {
  try {
    await loginUser(prisma, {
      phone,
      password: secret,
      sessionSecret,
      maxAgeSeconds: 3600,
      now,
    });
  } catch (error) {
    return error;
  }
  throw new Error("Login should have failed.");
}

function testPhone(): string {
  return `+1415555${String(randomInt(0, 10000)).padStart(4, "0")}`;
}

function formatPhone(phone: string): string {
  return `${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5)}`;
}

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`http://127.0.0.1${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cookieRequest(
  pathname: string,
  token: string,
  cookieName: string,
  method = "GET",
): Request {
  return new Request(`http://127.0.0.1${pathname}`, {
    method,
    headers: { cookie: `${cookieName}=${token}` },
  });
}

function loginRequest(
  phone: string,
  ip: string | null = null,
  secret = "wrong-horse-secret",
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (ip !== null) {
    headers.set("x-forwarded-for", ip);
  }
  return new Request("http://127.0.0.1/api/v1/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ phone, password: secret }),
  });
}
