import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export {}",
        shortCircuit: true,
      };
    }
    if (
      specifier === "./server/shared/request-log" &&
      context.parentURL?.endsWith("/src/instrumentation.ts")
    ) {
      return nextResolve("./server/shared/request-log.ts", context);
    }
    if (
      specifier === "./server/database/connectivity" &&
      context.parentURL?.endsWith("/src/instrumentation.ts")
    ) {
      return nextResolve("./server/database/connectivity.ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const { logFailedRequest, logRequest } =
  await import("../src/server/shared/request-log.ts");
const { onRequestError } = await import("../src/instrumentation.ts");

const requestId = "11111111-1111-4111-8111-111111111111";

test("a failed request log can be traced without credentials", () => {
  const password = "super-secret-password";
  const sessionToken = "session-cookie-value-123";
  const livekitSecret = "livekit-api-secret-value";
  const transcript = "the user said their bank pin is 4491";
  const queryToken = "query-token-should-stay-hidden";
  const lines: string[] = [];

  logFailedRequest(
    new Error(
      `login failed password=${password} sarjy_session=${sessionToken} LIVEKIT_API_SECRET=${livekitSecret} Bearer ${livekitSecret} transcript: ${transcript} https://api.example/weather?appid=${livekitSecret}`,
    ),
    {
      path: `/api/v1/auth/login?token=${queryToken}`,
      method: "POST",
      headers: {
        "x-request-id": requestId,
        "x-request-start": String(Date.now() - 40),
        cookie: `sarjy_session=${sessionToken}`,
        authorization: `Bearer ${livekitSecret}`,
      },
    },
    (line) => {
      lines.push(line);
    },
  );

  assert.equal(lines.length, 1);
  const logged = lines[0] ?? "";
  const parsed = JSON.parse(logged) as {
    level: string;
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    error: { name: string; message: string };
  };

  assert.equal(parsed.level, "error");
  assert.equal(parsed.requestId, requestId);
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.route, "/api/v1/auth/login");
  assert.equal(parsed.status, 500);
  assert.equal(parsed.durationMs >= 40, true);
  assert.equal(parsed.error.name, "Error");
  assert.match(parsed.error.message, /password=\[redacted\]/);
  assert.match(parsed.error.message, /transcript: \[redacted\]/);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "durationMs",
    "error",
    "level",
    "method",
    "requestId",
    "route",
    "status",
  ]);

  for (const secret of [
    password,
    sessionToken,
    livekitSecret,
    transcript,
    queryToken,
  ]) {
    assert.equal(logged.includes(secret), false, secret);
  }
});

test("unsafe request ids and non-error values are not copied into the log", () => {
  const lines: string[] = [];
  logRequest(
    {
      requestId: "not-a-uuid\npassword=super-secret-password",
      method: "POST\npassword=super-secret-password",
      route: "/api/v1/auth/login?token=query-token-should-stay-hidden",
      status: 500,
      durationMs: 12,
      error: { password: "super-secret-password", transcript: "hello there" },
    },
    (line) => {
      lines.push(line);
    },
  );

  const logged = lines[0] ?? "";
  const parsed = JSON.parse(logged) as {
    requestId: string;
    method: string;
    route: string;
    error: { message: string };
  };
  assert.match(
    parsed.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(parsed.method, "UNKNOWN");
  assert.equal(parsed.route, "/api/v1/auth/login");
  assert.equal(parsed.error.message, "Unexpected server error");
  assert.equal(logged.includes("super-secret-password"), false);
  assert.equal(logged.includes("query-token-should-stay-hidden"), false);
  assert.equal(logged.includes("hello there"), false);
});

describe("console and request error logs", { concurrency: false }, () => {
  test("console output redacts passwords, session tokens, and transcripts", async () => {
    const { installSafeConsole } =
      await import("../src/server/shared/request-log.ts");
    const password = "console-secret-password";
    const transcript = "the user said their bank pin is 4491";
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(
        line instanceof Error
          ? `${line.message}\n${line.stack ?? ""}`
          : String(line),
      );
    };
    installSafeConsole();

    try {
      console.error(
        new Error(`password=${password} transcript: ${transcript}`),
      );
      console.error(
        `{"message":"password=${password} transcript: ${transcript}"}`,
      );
    } finally {
      console.error = original;
    }

    const logged = lines.join("\n");
    assert.match(logged, /password=\[redacted\]/);
    assert.match(logged, /transcript: \[redacted\]/);
    assert.equal(logged.includes(password), false);
    assert.equal(logged.includes(transcript), false);
    const jsonLine = lines[1] ?? "";
    const parsed = JSON.parse(jsonLine) as { message: string };
    assert.equal(parsed.message.includes(password), false);
    assert.equal(parsed.message.includes(transcript), false);
  });

  test("onRequestError writes a safe failed-request log", async () => {
    const password = "hook-secret-password";
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };

    try {
      process.env.NEXT_RUNTIME = "nodejs";
      await onRequestError(
        new Error(
          `password=${password} postgresql://user:${password}@localhost/sarjy`,
        ),
        {
          path: "/api/v1/auth/login?token=query-token-should-stay-hidden",
          method: "POST",
          headers: {
            "x-request-id": requestId,
            "x-request-start": String(Date.now() - 15),
            cookie: "sarjy_session=session-cookie-value-123",
          },
        },
        {
          routerKind: "App Router",
          routePath: "/app/api/v1/auth/login",
          routeType: "route",
          revalidateReason: undefined,
        },
      );
    } finally {
      console.error = original;
      delete process.env.NEXT_RUNTIME;
    }

    assert.equal(lines.length, 1);
    const logged = lines[0] ?? "";
    const parsed = JSON.parse(logged) as {
      requestId: string;
      method: string;
      route: string;
      status: number;
      durationMs: number;
    };
    assert.equal(parsed.requestId, requestId);
    assert.equal(parsed.method, "POST");
    assert.equal(parsed.route, "/api/v1/auth/login");
    assert.equal(parsed.status, 500);
    assert.equal(parsed.durationMs >= 15, true);
    assert.equal(logged.includes(password), false);
    assert.equal(logged.includes("session-cookie-value-123"), false);
    assert.equal(logged.includes("query-token-should-stay-hidden"), false);
  });
});
