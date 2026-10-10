import "server-only";
import { inspect } from "node:util";

const REDACTED = "[redacted]";
const SESSION_SECRET_MIN_LENGTH = 32;
const INTERNAL_SERVICE_TOKEN_MIN_LENGTH = 32;
const DEFAULT_SESSION_COOKIE_NAME = "sarjy_session";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 2_592_000;
const DEFAULT_INTERNAL_SERVICE_TIMEOUT_MS = 5_000;

export const requiredServerEnvKeys = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "NEXT_PUBLIC_LIVEKIT_URL",
  "INTERNAL_SERVICE_TOKEN",
  "WEATHER_API_KEY",
  "WEATHER_API_BASE_URL",
] as const;

export const optionalServerEnvKeys = [
  "SESSION_COOKIE_NAME",
  "SESSION_MAX_AGE_SECONDS",
  "INTERNAL_SERVICE_TIMEOUT_MS",
] as const;

export type EnvSource = Record<string, string | undefined>;

export type EnvIssue = {
  readonly key: string;
  readonly message: string;
};

export type ServerConfig = {
  readonly database: {
    readonly url: string;
  };
  readonly session: {
    readonly secret: string;
    readonly cookieName: string;
    readonly maxAgeSeconds: number;
  };
  readonly livekit: {
    readonly url: string;
    readonly apiKey: string;
    readonly apiSecret: string;
    readonly publicUrl: string;
  };
  readonly internalService: {
    readonly token: string;
    readonly timeoutMs: number;
  };
  readonly weather: {
    readonly apiKey: string;
    readonly baseUrl: string;
  };
};

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(formatIssues(issues));
    this.name = "EnvironmentValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

type PublicConfig = {
  cookieName: string;
  maxAgeSeconds: number;
  livekitUrl: string;
  livekitPublicUrl: string;
  timeoutMs: number;
  weatherBaseUrl: string;
};

let cached: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  if (!cached) {
    cached = loadServerConfig(process.env);
  }
  return cached;
}

export function loadServerConfig(
  source: EnvSource = process.env,
): ServerConfig {
  const issues: EnvIssue[] = [];

  const databaseUrl = requiredDatabaseUrl(source, issues);
  const sessionSecret = requiredSecret(
    source,
    issues,
    "SESSION_SECRET",
    SESSION_SECRET_MIN_LENGTH,
    "Required. Set a random string of at least 32 characters.",
    "Invalid. Use a random string of at least 32 characters.",
  );
  const cookieName = optionalCookieName(source, issues);
  const maxAgeSeconds = optionalInteger(
    source,
    issues,
    "SESSION_MAX_AGE_SECONDS",
    DEFAULT_SESSION_MAX_AGE_SECONDS,
    60,
    31_536_000,
    "Invalid. Use a whole number of seconds from 60 to 31536000.",
  );
  const livekitUrl = requiredPublicUrl(
    source,
    issues,
    "LIVEKIT_URL",
    ["http:", "https:"],
    "Required. Set the server LiveKit URL (http:// or https://).",
    "Invalid. Use an absolute http:// or https:// URL with no username, password, or query string.",
  );
  const livekitApiKey = requiredValue(
    source,
    issues,
    "LIVEKIT_API_KEY",
    "Required. Set the server LiveKit API key. Do not use a NEXT_PUBLIC_ variable.",
  );
  const livekitApiSecret = requiredValue(
    source,
    issues,
    "LIVEKIT_API_SECRET",
    "Required. Set the server LiveKit API secret. Do not use a NEXT_PUBLIC_ variable.",
  );
  const livekitPublicUrl = requiredPublicUrl(
    source,
    issues,
    "NEXT_PUBLIC_LIVEKIT_URL",
    ["ws:", "wss:"],
    "Required. Set the browser LiveKit WebSocket URL (ws:// or wss://).",
    "Invalid. Use an absolute ws:// or wss:// URL with no username, password, or query string.",
  );
  const internalServiceToken = requiredSecret(
    source,
    issues,
    "INTERNAL_SERVICE_TOKEN",
    INTERNAL_SERVICE_TOKEN_MIN_LENGTH,
    "Required. Set a random token of at least 32 characters for the Python agent.",
    "Invalid. Use a random token of at least 32 characters.",
  );
  const timeoutMs = optionalInteger(
    source,
    issues,
    "INTERNAL_SERVICE_TIMEOUT_MS",
    DEFAULT_INTERNAL_SERVICE_TIMEOUT_MS,
    100,
    60_000,
    "Invalid. Use a whole number of milliseconds from 100 to 60000.",
  );
  const weatherApiKey = requiredValue(
    source,
    issues,
    "WEATHER_API_KEY",
    "Required. Set the weather provider API key.",
  );
  const weatherBaseUrl = requiredPublicUrl(
    source,
    issues,
    "WEATHER_API_BASE_URL",
    ["http:", "https:"],
    "Required. Set the weather provider base URL (http:// or https://).",
    "Invalid. Use an absolute http:// or https:// URL with no username, password, or query string.",
  );

  if (
    databaseUrl === null ||
    sessionSecret === null ||
    cookieName === null ||
    maxAgeSeconds === null ||
    livekitUrl === null ||
    livekitApiKey === null ||
    livekitApiSecret === null ||
    livekitPublicUrl === null ||
    internalServiceToken === null ||
    timeoutMs === null ||
    weatherApiKey === null ||
    weatherBaseUrl === null
  ) {
    throw new EnvironmentValidationError(issues);
  }

  return sealServerConfig(
    {
      databaseUrl,
      sessionSecret,
      cookieName,
      maxAgeSeconds,
      livekitUrl,
      livekitApiKey,
      livekitApiSecret,
      livekitPublicUrl,
      internalServiceToken,
      timeoutMs,
      weatherApiKey,
      weatherBaseUrl,
    },
    {
      cookieName,
      maxAgeSeconds,
      livekitUrl,
      livekitPublicUrl,
      timeoutMs,
      weatherBaseUrl,
    },
  );
}

function formatIssues(issues: readonly EnvIssue[]): string {
  const details = issues.map((issue) => `- ${issue.key}: ${issue.message}`);
  return [
    "Invalid server environment. Fix the settings below, then restart the server. See .env.example.",
    "",
    ...details,
  ].join("\n");
}

function readText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requiredDatabaseUrl(
  source: EnvSource,
  issues: EnvIssue[],
): string | null {
  const key = "DATABASE_URL";
  const value = readText(source[key]);
  if (value === undefined) {
    issues.push({
      key,
      message:
        "Required. Set a PostgreSQL connection string (postgresql:// or postgres://).",
    });
    return null;
  }

  let protocol = "";
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = "";
  }

  if (protocol !== "postgresql:" && protocol !== "postgres:") {
    issues.push({
      key,
      message:
        "Invalid. Use a PostgreSQL connection string (postgresql:// or postgres://).",
    });
    return null;
  }

  return value;
}

function requiredValue(
  source: EnvSource,
  issues: EnvIssue[],
  key: string,
  missing: string,
): string | null {
  const value = readText(source[key]);
  if (value === undefined) {
    issues.push({ key, message: missing });
    return null;
  }
  return value;
}

function requiredSecret(
  source: EnvSource,
  issues: EnvIssue[],
  key: string,
  minLength: number,
  missing: string,
  invalid: string,
): string | null {
  const value = requiredValue(source, issues, key, missing);
  if (value === null) {
    return null;
  }
  if (value.length < minLength) {
    issues.push({ key, message: invalid });
    return null;
  }
  return value;
}

function requiredPublicUrl(
  source: EnvSource,
  issues: EnvIssue[],
  key: string,
  protocols: readonly string[],
  missing: string,
  invalid: string,
): string | null {
  const value = readText(source[key]);
  if (value === undefined) {
    issues.push({ key, message: missing });
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ key, message: invalid });
    return null;
  }

  const protocolAllowed = protocols.includes(url.protocol);
  const hasUserInfo = url.username !== "" || url.password !== "";
  const hasQuery = url.search !== "" || url.hash !== "";
  if (!protocolAllowed || hasUserInfo || hasQuery) {
    issues.push({ key, message: invalid });
    return null;
  }

  return value;
}

function optionalCookieName(
  source: EnvSource,
  issues: EnvIssue[],
): string | null {
  const key = "SESSION_COOKIE_NAME";
  const value = readText(source[key]);
  if (value === undefined) {
    return DEFAULT_SESSION_COOKIE_NAME;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    issues.push({
      key,
      message:
        "Invalid. Use 1 to 64 characters: letters, numbers, underscores, or hyphens.",
    });
    return null;
  }
  return value;
}

function optionalInteger(
  source: EnvSource,
  issues: EnvIssue[],
  key: string,
  defaultValue: number,
  min: number,
  max: number,
  invalid: string,
): number | null {
  const value = readText(source[key]);
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^[0-9]+$/.test(value)) {
    issues.push({ key, message: invalid });
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    issues.push({ key, message: invalid });
    return null;
  }
  return parsed;
}

type SecretConfig = PublicConfig & {
  databaseUrl: string;
  sessionSecret: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  internalServiceToken: string;
  weatherApiKey: string;
};

function sealServerConfig(
  secrets: SecretConfig,
  publicValues: PublicConfig,
): ServerConfig {
  const database = sealGroup({ url: secrets.databaseUrl }, () => ({
    url: REDACTED,
  }));
  const session = sealGroup(
    {
      secret: secrets.sessionSecret,
      cookieName: publicValues.cookieName,
      maxAgeSeconds: publicValues.maxAgeSeconds,
    },
    () => ({
      secret: REDACTED,
      cookieName: publicValues.cookieName,
      maxAgeSeconds: publicValues.maxAgeSeconds,
    }),
  );
  const livekit = sealGroup(
    {
      url: publicValues.livekitUrl,
      apiKey: secrets.livekitApiKey,
      apiSecret: secrets.livekitApiSecret,
      publicUrl: publicValues.livekitPublicUrl,
    },
    () => ({
      url: publicValues.livekitUrl,
      apiKey: REDACTED,
      apiSecret: REDACTED,
      publicUrl: publicValues.livekitPublicUrl,
    }),
  );
  const internalService = sealGroup(
    {
      token: secrets.internalServiceToken,
      timeoutMs: publicValues.timeoutMs,
    },
    () => ({
      token: REDACTED,
      timeoutMs: publicValues.timeoutMs,
    }),
  );
  const weather = sealGroup(
    {
      apiKey: secrets.weatherApiKey,
      baseUrl: publicValues.weatherBaseUrl,
    },
    () => ({
      apiKey: REDACTED,
      baseUrl: publicValues.weatherBaseUrl,
    }),
  );

  return sealGroup(
    { database, session, livekit, internalService, weather },
    () => redactedServerConfig(publicValues),
  );
}

function redactedServerConfig(publicValues: PublicConfig) {
  return {
    database: { url: REDACTED },
    session: {
      secret: REDACTED,
      cookieName: publicValues.cookieName,
      maxAgeSeconds: publicValues.maxAgeSeconds,
    },
    livekit: {
      url: publicValues.livekitUrl,
      apiKey: REDACTED,
      apiSecret: REDACTED,
      publicUrl: publicValues.livekitPublicUrl,
    },
    internalService: {
      token: REDACTED,
      timeoutMs: publicValues.timeoutMs,
    },
    weather: {
      apiKey: REDACTED,
      baseUrl: publicValues.weatherBaseUrl,
    },
  };
}

function sealGroup<T extends object>(value: T, view: () => unknown): T {
  Object.defineProperty(value, "toJSON", {
    enumerable: false,
    value: view,
  });
  Object.defineProperty(value, inspect.custom, {
    enumerable: false,
    value: view,
  });
  return Object.freeze(value);
}
