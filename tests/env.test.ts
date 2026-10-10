import assert from "node:assert/strict";
import { Console } from "node:console";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { inspect } from "node:util";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export {}",
        shortCircuit: true,
      };
    }
    if (
      specifier === "./server/config/env" &&
      context.parentURL?.endsWith("/src/instrumentation.ts")
    ) {
      return nextResolve("./server/config/env.ts", context);
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

const root = path.resolve(import.meta.dirname, "..");

const {
  EnvironmentValidationError,
  loadServerConfig,
  optionalServerEnvKeys,
  requiredServerEnvKeys,
} = await import("../src/server/config/env.ts");

const { register } = await import("../src/instrumentation.ts");

const secretKeys = [
  "SESSION_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "INTERNAL_SERVICE_TOKEN",
  "WEATHER_API_KEY",
] as const;

test("missing required settings list each name and the expected format", () => {
  const error = captureError(() => loadServerConfig({}));

  assert.match(
    error.message,
    /^Invalid server environment\. Fix the settings below, then restart the server\. See \.env\.example\./,
  );
  for (const key of requiredServerEnvKeys) {
    assert.match(error.message, new RegExp(`^- ${key}: Required\\. `, "m"));
  }
  for (const key of optionalServerEnvKeys) {
    assert.equal(error.message.includes(key), false);
  }
  assert.equal(error.issues.length, requiredServerEnvKeys.length);
});

test("invalid settings name the variable and omit the supplied value", () => {
  const databasePassword = "db-password-should-stay-hidden";
  const shortSessionSecret = "too-short-session-secret";
  const livekitSecret = "livekit-secret-should-stay-hidden";
  const weatherKey = "weather-key-should-stay-hidden";

  const error = captureError(() =>
    loadServerConfig({
      DATABASE_URL: `mysql://user:${databasePassword}@localhost:5432/sarjy`,
      SESSION_SECRET: shortSessionSecret,
      SESSION_COOKIE_NAME: "bad cookie",
      SESSION_MAX_AGE_SECONDS: "10",
      LIVEKIT_URL: `https://user:${livekitSecret}@localhost:7880?token=abc`,
      LIVEKIT_API_KEY: "replace-with-livekit-api-key",
      LIVEKIT_API_SECRET: "replace-with-livekit-api-secret",
      NEXT_PUBLIC_LIVEKIT_URL: "http://localhost:7880",
      INTERNAL_SERVICE_TOKEN: "short-token",
      INTERNAL_SERVICE_TIMEOUT_MS: "5s",
      WEATHER_API_KEY: weatherKey,
      WEATHER_API_BASE_URL: "not a url",
    }),
  );

  const logged = loggedText(error);
  for (const secret of [
    databasePassword,
    shortSessionSecret,
    livekitSecret,
    weatherKey,
    "bad cookie",
    "short-token",
  ]) {
    assert.equal(logged.includes(secret), false, secret);
  }
  assert.match(error.message, /DATABASE_URL: Invalid/);
  assert.match(error.message, /SESSION_SECRET: Invalid/);
  assert.match(error.message, /LIVEKIT_URL: Invalid/);
  assert.match(error.message, /NEXT_PUBLIC_LIVEKIT_URL: Invalid/);
  assert.match(error.message, /WEATHER_API_BASE_URL: Invalid/);
  assert.equal(error.message.includes("LIVEKIT_API_KEY"), false);
  assert.equal(error.message.includes("WEATHER_API_KEY"), false);
});

test("valid settings keep secrets available but out of logs", () => {
  const source = validEnv();
  const config = loadServerConfig(source);

  assert.equal(config.database.url, source.DATABASE_URL);
  assert.equal(config.session.secret, source.SESSION_SECRET);
  assert.equal(config.session.cookieName, "sarjy_session");
  assert.equal(config.session.maxAgeSeconds, 2_592_000);
  assert.equal(config.livekit.url, "http://localhost:7880");
  assert.equal(config.livekit.apiKey, source.LIVEKIT_API_KEY);
  assert.equal(config.livekit.apiSecret, source.LIVEKIT_API_SECRET);
  assert.equal(config.livekit.publicUrl, "ws://localhost:7880");
  assert.equal(config.internalService.token, source.INTERNAL_SERVICE_TOKEN);
  assert.equal(config.internalService.timeoutMs, 5_000);
  assert.equal(config.weather.apiKey, source.WEATHER_API_KEY);
  assert.equal(config.weather.baseUrl, "https://weather.example");

  const logged = [
    loggedText(config),
    loggedText(config.database),
    loggedText(config.session),
    loggedText(config.livekit),
    loggedText(config.internalService),
    loggedText(config.weather),
  ].join("\n");

  for (const key of [
    "DATABASE_URL",
    "SESSION_SECRET",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "INTERNAL_SERVICE_TOKEN",
    "WEATHER_API_KEY",
  ] as const) {
    assert.equal(logged.includes(source[key] ?? ""), false, key);
  }
  assert.match(logged, /\[redacted\]/);
  assert.match(logged, /sarjy_session/);
  assert.match(logged, /http:\/\/localhost:7880/);
});

test("optional settings can override the defaults", () => {
  const config = loadServerConfig(
    validEnv({
      SESSION_COOKIE_NAME: "custom_session",
      SESSION_MAX_AGE_SECONDS: "3600",
      INTERNAL_SERVICE_TIMEOUT_MS: "1500",
    }),
  );

  assert.equal(config.session.cookieName, "custom_session");
  assert.equal(config.session.maxAgeSeconds, 3600);
  assert.equal(config.internalService.timeoutMs, 1500);
});

test(".env.example has placeholders for every setting and passes validation", async () => {
  const text = await readFile(path.join(root, ".env.example"), "utf8");
  const source = parseEnvExample(text);
  const keys = Object.keys(source).sort();
  const expected = [...requiredServerEnvKeys, ...optionalServerEnvKeys].sort();
  assert.deepEqual(keys, expected);

  const publicKeys = keys.filter((key) => key.startsWith("NEXT_PUBLIC_"));
  assert.deepEqual(publicKeys, ["NEXT_PUBLIC_LIVEKIT_URL"]);
  assert.equal(
    source.DATABASE_URL,
    "postgresql://sarjy:sarjy@127.0.0.1:5433/sarjy",
  );
  for (const key of secretKeys) {
    assert.match(source[key] ?? "", /^replace-with-/);
  }

  const config = loadServerConfig(source);
  assert.equal(config.database.url, source.DATABASE_URL);
  assert.equal(loggedText(config).includes("PASSWORD"), false);
  assert.equal(loggedText(config).includes(source.SESSION_SECRET ?? ""), false);
});

test("startup validation runs only for the Node.js server", async () => {
  const instrumentationSource = await readFile(
    path.join(root, "src/instrumentation.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    instrumentationSource,
    /^import\s+.*server\/config\/env/m,
  );
  assert.match(instrumentationSource, /NEXT_RUNTIME !== "nodejs"/);

  const previous = new Map<string, string | undefined>();
  for (const key of [
    "NEXT_RUNTIME",
    ...requiredServerEnvKeys,
    ...optionalServerEnvKeys,
  ]) {
    previous.set(key, process.env[key]);
  }
  const canary = "startup-canary-secret-should-not-print";

  try {
    for (const key of [...requiredServerEnvKeys, ...optionalServerEnvKeys]) {
      delete process.env[key];
    }
    process.env.NEXT_RUNTIME = "edge";
    process.env.LIVEKIT_API_SECRET = canary;
    await register();

    process.env.NEXT_RUNTIME = "nodejs";
    await assert.rejects(register(), (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);
      const logged = loggedText(error);
      assert.match(logged, /DATABASE_URL: Required/);
      assert.equal(logged.includes(canary), false);
      return true;
    });
  } finally {
    for (const [key, value] of previous) {
      restoreEnv(key, value);
    }
  }
});

function captureError(
  run: () => void,
): InstanceType<typeof EnvironmentValidationError> {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected environment validation to fail.");
}

function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgresql://USER:PASSWORD@localhost:5432/sarjy",
    SESSION_SECRET: "replace-with-a-random-session-secret",
    LIVEKIT_URL: "http://localhost:7880",
    LIVEKIT_API_KEY: "replace-with-livekit-api-key",
    LIVEKIT_API_SECRET: "replace-with-livekit-api-secret",
    NEXT_PUBLIC_LIVEKIT_URL: "ws://localhost:7880",
    INTERNAL_SERVICE_TOKEN: "replace-with-a-random-internal-service-token",
    WEATHER_API_KEY: "replace-with-weather-api-key",
    WEATHER_API_BASE_URL: "https://weather.example",
    ...overrides,
  };
}

function parseEnvExample(text: string): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    assert.ok(separator > 0);
    const key = trimmed.slice(0, separator);
    assert.equal(source[key], undefined);
    source[key] = trimmed.slice(separator + 1);
  }
  return source;
}

function loggedText(value: unknown): string {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const logger = new Console({ stdout: stream, stderr: stream });
  logger.log(value);
  logger.error(value);
  return `${Buffer.concat(chunks).toString("utf8")}\n${inspect(value)}`;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
