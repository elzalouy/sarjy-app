import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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
      specifier.startsWith("./") &&
      !specifier.endsWith(".ts") &&
      context.parentURL?.includes("/src/server/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { handleApiRequest, clientError } =
  await import("../src/server/shared/api-error.ts");
const {
  readInteger,
  readJsonBody,
  readObject,
  readOptionalString,
  readString,
  rejectInvalid,
} = await import("../src/server/shared/validate-request.ts");

const requestId = "11111111-1111-4111-8111-111111111111";
const password = "secret-password-value";
const queryToken = "query-token-should-stay-hidden";

test("validation errors use one client shape and hide submitted values", async () => {
  const lines: string[] = [];
  const response = await handleApiRequest(
    jsonRequest({ phone: "", password, age: 1.5 }),
    async function validate() {
      const body = readObject(
        await readJsonBody(jsonRequest({ phone: "", password, age: 1.5 })),
      );
      assert.equal(body.ok, true);
      if (!body.ok) {
        return Response.json({});
      }
      const phone = readString(body.value.phone, "phone", {
        minLength: 8,
        maxLength: 20,
      });
      const secret = readString(body.value.password, "password", {
        minLength: 30,
        maxLength: 72,
      });
      const age = readInteger(body.value.age, "age", { min: 1, max: 120 });
      rejectInvalid([phone, secret, age]);
      return Response.json({ ok: true });
    },
    (line) => {
      lines.push(line);
    },
  );

  const body = (await response.json()) as ClientError;
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.equal(body.error.code, "validation_error");
  assert.equal(body.error.message, "The request is invalid.");
  assert.equal(body.error.requestId, requestId);
  assert.deepEqual(
    body.error.fields?.map((field) => field.name),
    ["phone", "password", "age"],
  );
  assert.equal(serialized(body).includes(password), false);
  assert.equal(serialized(body).includes("stack"), false);
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0] ?? "") as {
    status: number;
    error: { message: string };
  };
  assert.equal(logged.status, 400);
  assert.match(logged.error.message, /Fields: phone, password, age/);
  assert.equal(logged.error.message.includes(password), false);
});

test("invalid JSON does not echo the request body", async () => {
  const response = await handleApiRequest(
    new Request(`http://localhost/api/v1/example?token=${queryToken}`, {
      method: "POST",
      headers: { "x-request-id": requestId },
      body: `password=${password}`,
    }),
    async () => {
      await readJsonBody(
        new Request("http://localhost/api/v1/example", {
          method: "POST",
          body: `password=${password}`,
        }),
      );
      return Response.json({ ok: true });
    },
    () => undefined,
  );

  const body = (await response.json()) as ClientError;
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "validation_error");
  assert.deepEqual(body.error.fields, [
    { name: "body", message: "Request body must be JSON." },
  ]);
  assert.equal(serialized(body).includes(password), false);
  assert.equal(serialized(body).includes(queryToken), false);
});

test("unexpected errors stay generic for the client and detailed in the log", async () => {
  const lines: string[] = [];
  const failure = new Error(
    `password=${password} transcript: the user said hello`,
  );
  failure.stack = `Error: password=${password}\n    at secretFunction (/app/secret.ts:10:1)`;

  const response = await handleApiRequest(
    jsonRequest({}),
    async () => {
      throw failure;
    },
    (line) => {
      lines.push(line);
    },
  );

  const body = (await response.json()) as ClientError;
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.message, "Something went wrong. Try again.");
  assert.equal(body.error.requestId, requestId);
  assert.equal(body.error.fields, undefined);
  const clientText = serialized(body);
  assert.equal(clientText.includes(password), false);
  assert.equal(clientText.includes("secretFunction"), false);
  assert.equal(clientText.includes("secret.ts"), false);
  assert.equal(clientText.includes("transcript"), false);

  const logged = lines[0] ?? "";
  const parsed = JSON.parse(logged) as {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    error: { name: string; message: string };
  };
  assert.equal(parsed.requestId, requestId);
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.route, "/api/v1/example");
  assert.equal(parsed.status, 500);
  assert.equal(typeof parsed.durationMs, "number");
  assert.match(parsed.error.message, /password=\[redacted\]/);
  assert.match(parsed.error.message, /transcript: \[redacted\]/);
  assert.equal(logged.includes(password), false);
  assert.equal(logged.includes(queryToken), false);
  assert.equal(logged.includes("secret.ts"), false);
});

test("expected client errors use the same envelope", async () => {
  const response = await handleApiRequest(
    jsonRequest({}),
    async () => {
      throw clientError("notFound");
    },
    () => undefined,
  );
  const body = (await response.json()) as ClientError;
  assert.equal(response.status, 404);
  assert.deepEqual(Object.keys(body.error).sort(), [
    "code",
    "message",
    "requestId",
  ]);
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.message, "Not found.");
  assert.equal(body.error.requestId, requestId);
});

test("a valid request returns the handler response", async () => {
  const lines: string[] = [];
  const response = await handleApiRequest(
    jsonRequest({ name: "Sara", age: 30 }),
    async () => {
      const parsed = readObject(
        await readJsonBody(jsonRequest({ name: "Sara", age: 30 })),
      );
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        return Response.json({});
      }
      const name = readString(parsed.value.name, "name", {
        minLength: 1,
        maxLength: 40,
        trim: true,
      });
      const age = readInteger(parsed.value.age, "age", { min: 1, max: 120 });
      const nickname = readOptionalString(parsed.value.nickname, "nickname", {
        maxLength: 40,
      });
      rejectInvalid([name, age, nickname]);
      assert.equal(nickname.ok && nickname.value, null);
      assert.equal(name.ok, true);
      assert.equal(age.ok, true);
      if (!name.ok || !age.ok) {
        return Response.json({});
      }
      return Response.json({ name: name.value, age: age.value });
    },
    (line) => {
      lines.push(line);
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(await response.json(), { name: "Sara", age: 30 });
  const logged = JSON.parse(lines[0] ?? "") as {
    status: number;
    route: string;
    error?: unknown;
  };
  assert.equal(logged.status, 200);
  assert.equal(logged.route, "/api/v1/example");
  assert.equal(logged.error, undefined);
});

type ClientError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ name: string; message: string }>;
  };
};

function jsonRequest(body: unknown): Request {
  return new Request(`http://localhost/api/v1/example?token=${queryToken}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}
