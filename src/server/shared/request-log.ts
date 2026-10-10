import "server-only";

const REDACTED = "[redacted]";
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_START_HEADER = "x-request-start";

export type RequestLogInput = {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  error?: unknown;
};

type RequestLogLine = {
  level: "info" | "error";
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  error?: {
    name: string;
    message: string;
  };
};

type HeaderMap = NodeJS.Dict<string | string[]>;
type LogWriter = (line: string) => void;

let consoleInstalled = false;

export function installSafeConsole(): void {
  if (consoleInstalled) {
    return;
  }
  consoleInstalled = true;
  for (const method of ["error", "info", "log", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args.map(redactLogArgument));
    };
  }
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function readRequestId(value: string | null | undefined): string {
  if (typeof value === "string" && REQUEST_ID_PATTERN.test(value)) {
    return value;
  }
  return createRequestId();
}

export function logRequest(entry: RequestLogInput, write?: LogWriter): void {
  const status = normalizeStatus(entry.status);
  const line: RequestLogLine = {
    level: status >= 500 ? "error" : "info",
    requestId: readRequestId(entry.requestId),
    method: normalizeMethod(entry.method),
    route: routeFromPath(entry.route),
    status,
    durationMs: normalizeDuration(entry.durationMs),
  };
  if (entry.error !== undefined) {
    line.error = safeErrorInfo(entry.error);
  }
  emit(line, write);
}

export function logFailedRequest(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: HeaderMap;
  },
  write?: LogWriter,
): void {
  logRequest(
    {
      requestId: readHeader(request.headers, REQUEST_ID_HEADER) ?? "",
      method: request.method,
      route: request.path,
      status: 500,
      durationMs: durationFromStart(
        readHeader(request.headers, REQUEST_START_HEADER),
      ),
      error,
    },
    write,
  );
}

function emit(line: RequestLogLine, write?: LogWriter): void {
  const output = JSON.stringify(line);
  if (write) {
    write(output);
    return;
  }
  if (line.level === "error") {
    console.error(output);
    return;
  }
  console.info(output);
}

function safeErrorInfo(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) {
    return { name: "Error", message: "Unexpected server error" };
  }
  const name = error.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 80);
  const message = redactText(error.message).slice(0, 300);
  return {
    name: name === "" ? "Error" : name,
    message: message === "" ? "Unexpected server error" : message,
  };
}

function redactText(value: string): string {
  const singleLine = value.replace(/[\u0000-\u001F\u007F]/g, " ");
  const withoutSecrets = singleLine
    .replace(/\b(?:postgresql|postgres):\/\/\S+/gi, REDACTED)
    .replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsarjy_session=[^;\s]*/gi, `sarjy_session=${REDACTED}`)
    .replace(
      /\b(password|passwd|session(?:[_-]?token)?|session(?:[_-]?secret)?|token|secret|api[_-]?key|api[_-]?secret|authorization|cookie|livekit(?:[_-]?api)?[_-]?(?:key|secret))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
      `$1$2${REDACTED}`,
    );
  return withoutSecrets.replace(
    /\btranscript\b\s*[:=]?\s*(?:"[^"]*"|'[^']*'|[^\n"{}]*)/gi,
    `transcript: ${REDACTED}`,
  );
}

function redactLogArgument(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value instanceof Error) {
    const safe = new Error(redactText(value.message));
    const name = value.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 80);
    safe.name = name === "" ? "Error" : name;
    if (typeof value.stack === "string") {
      safe.stack = redactText(value.stack);
    }
    return safe;
  }
  return value;
}

function readHeader(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function durationFromStart(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return 0;
  }
  const started = Number(value);
  if (!Number.isSafeInteger(started)) {
    return 0;
  }
  return normalizeDuration(Date.now() - started);
}

function routeFromPath(path: string): string {
  const withoutQuery = path.split("?")[0]?.split("#")[0] ?? "/";
  const cleaned = withoutQuery.replace(/[^\x20-\x7E]/g, "");
  if (!cleaned.startsWith("/")) {
    return "/";
  }
  return cleaned.slice(0, 200);
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  if (!/^[A-Z]{1,10}$/.test(normalized)) {
    return "UNKNOWN";
  }
  return normalized;
}

function normalizeStatus(status: number): number {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return 500;
  }
  return status;
}

function normalizeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 0;
  }
  return Math.round(durationMs);
}
