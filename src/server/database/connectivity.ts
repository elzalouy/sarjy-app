import "server-only";
import { getPrismaClient } from "./prisma";

export type DatabaseQueryable = {
  $queryRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

export type DatabaseConnectionOk = {
  readonly ok: true;
};

export type DatabaseConnectionFail = {
  readonly ok: false;
  readonly code: DatabaseConnectionCode;
  readonly message: string;
};

export type DatabaseConnectionResult =
  | DatabaseConnectionOk
  | DatabaseConnectionFail;

export const databaseConnectionCodes = {
  connectionRefused: "connection_refused",
  hostUnreachable: "host_unreachable",
  timeout: "timeout",
  authFailed: "auth_failed",
  databaseMissing: "database_missing",
  unavailable: "unavailable",
  unknown: "unknown",
} as const;

export type DatabaseConnectionCode =
  (typeof databaseConnectionCodes)[keyof typeof databaseConnectionCodes];

const messages: Record<DatabaseConnectionCode, string> = {
  connection_refused:
    "The database refused the connection. Check that PostgreSQL is running.",
  host_unreachable:
    "The database host could not be reached. Check DATABASE_URL host and port.",
  timeout:
    "The database did not respond in time. Check that PostgreSQL is running.",
  auth_failed: "The database rejected the credentials. Check DATABASE_URL.",
  database_missing: "The database name was not found. Check DATABASE_URL.",
  unavailable: "The database is not ready. Try again.",
  unknown:
    "The database connection failed. Check DATABASE_URL and that PostgreSQL is running.",
};

export class DatabaseConnectionError extends Error {
  readonly code: DatabaseConnectionCode;

  constructor(code: DatabaseConnectionCode, message: string) {
    super(message);
    this.name = "DatabaseConnectionError";
    this.code = code;
  }
}

export async function checkDatabaseConnection(
  client: DatabaseQueryable = getPrismaClient(),
): Promise<DatabaseConnectionResult> {
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    const code = classifyConnectionError(error);
    return {
      ok: false,
      code,
      message: messages[code],
    };
  }
}

export async function verifyDatabaseConnection(
  client?: DatabaseQueryable,
): Promise<void> {
  const result = await checkDatabaseConnection(client);
  if (!result.ok) {
    throw new DatabaseConnectionError(result.code, result.message);
  }
}

function classifyConnectionError(error: unknown): DatabaseConnectionCode {
  const { codes, kinds } = collectErrorSignals(error);
  for (const kind of kinds) {
    const mapped = mapErrorKind(kind);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  for (const code of codes) {
    const mapped = mapErrorCode(code);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return databaseConnectionCodes.unknown;
}

function mapErrorKind(kind: string): DatabaseConnectionCode | undefined {
  switch (kind) {
    case "DatabaseNotReachable":
      return databaseConnectionCodes.connectionRefused;
    case "AuthenticationFailed":
      return databaseConnectionCodes.authFailed;
    case "DatabaseDoesNotExist":
      return databaseConnectionCodes.databaseMissing;
    case "SocketTimeout":
      return databaseConnectionCodes.timeout;
    case "TlsConnectionError":
      return databaseConnectionCodes.hostUnreachable;
    default:
      return undefined;
  }
}

function mapErrorCode(code: string): DatabaseConnectionCode | undefined {
  switch (code) {
    case "ECONNREFUSED":
      return databaseConnectionCodes.connectionRefused;
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return databaseConnectionCodes.hostUnreachable;
    case "ETIMEDOUT":
    case "ECONNRESET":
      return databaseConnectionCodes.timeout;
    case "28P01":
    case "28000":
      return databaseConnectionCodes.authFailed;
    case "3D000":
      return databaseConnectionCodes.databaseMissing;
    case "57P03":
    case "53300":
      return databaseConnectionCodes.unavailable;
    default:
      return undefined;
  }
}

function collectErrorSignals(error: unknown): {
  codes: string[];
  kinds: string[];
} {
  const codes: string[] = [];
  const kinds: string[] = [];
  const seen = new Set<object>();

  visit(error, seen, codes, kinds);
  return { codes, kinds };
}

function visit(
  value: unknown,
  seen: Set<object>,
  codes: string[],
  kinds: string[],
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, seen, codes, kinds);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  pushSignal(codes, record.code);
  pushSignal(codes, record.originalCode);
  pushSignal(kinds, record.kind);
  visit(record.cause, seen, codes, kinds);
  visit(record.meta, seen, codes, kinds);
  visit(record.driverAdapterError, seen, codes, kinds);
}

function pushSignal(list: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0 && value.length <= 64) {
    list.push(value);
  }
}
