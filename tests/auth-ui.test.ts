import assert from "node:assert/strict";
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

const { assertPassword } = await import("../src/server/auth/password.ts");
const { InvalidPhoneNumberError, normalizePhoneNumber } =
  await import("../src/server/shared/phone-number.ts");
const { readSessionUser } =
  await import("../src/server/auth/read-session-user.ts");
const { authFailureFromPayload, formErrorsFromFailure } =
  await import("../src/features/auth/auth-client.ts");
const {
  credentialIssues,
  hasCredentialIssues,
  livePasswordIssue,
  livePhoneIssue,
} = await import("../src/features/auth/credentials.ts");

const root = path.resolve(import.meta.dirname, "..");

test("client format hints match the server phone and password rules", () => {
  const phones = [
    "+14155552671",
    "+1 415 555 2671",
    "+1 (415) 555-2671",
    "0014155552671",
  ];
  for (const phone of phones) {
    assert.equal(livePhoneIssue(phone), undefined);
    assert.equal(normalizePhoneNumber(phone), "+14155552671");
  }

  for (const phone of ["4155552671", "123", "+012345678"]) {
    assert.equal(livePhoneIssue(phone), phoneError(phone));
  }
  assert.equal(livePhoneIssue(""), undefined);
  assert.equal(livePhoneIssue("   "), undefined);

  assert.equal(livePasswordIssue(""), undefined);
  assert.equal(livePasswordIssue("short"), passwordError("short"));
  assert.equal(
    livePasswordIssue("x".repeat(129)),
    passwordError("x".repeat(129)),
  );
  assert.equal(livePasswordIssue("correct-horse"), undefined);

  const empty = credentialIssues("", "");
  assert.equal(hasCredentialIssues(empty), true);
  assert.equal(empty.phone, phoneError(""));
  assert.equal(empty.password, passwordError(""));

  const ready = credentialIssues("+1 415 555 2671", "correct-horse");
  assert.equal(hasCredentialIssues(ready), false);
});

test("auth errors keep invalid credentials and server failures distinct", () => {
  const invalid = authFailureFromPayload({
    error: {
      code: "unauthorized",
      message: "The phone number or password is incorrect.",
    },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(
      formErrorsFromFailure(invalid).form,
      "The phone number or password is incorrect.",
    );
  }

  const duplicate = authFailureFromPayload({
    error: {
      code: "conflict",
      message: "That phone number is already registered.",
    },
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(
      formErrorsFromFailure(duplicate).form,
      "That phone number is already registered.",
    );
  }

  const validation = authFailureFromPayload({
    error: {
      code: "validation_error",
      message: "The request is invalid.",
      fields: [{ name: "password", message: "Use at least 8 characters." }],
    },
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    const errors = formErrorsFromFailure(validation);
    assert.equal(errors.password, "Use at least 8 characters.");
    assert.equal(errors.form, undefined);
  }

  const broken = authFailureFromPayload("nope");
  assert.equal(broken.ok, false);
  if (!broken.ok) {
    assert.equal(broken.message, "Something went wrong. Try again.");
    assert.deepEqual(broken.fields, []);
  }
});

test("a missing session token does not open a protected page", async () => {
  assert.equal(await readSessionUser(null), null);
  assert.equal(await readSessionUser(""), null);
});

test("private pages check the session on the server", async () => {
  const layout = await readFile(
    path.join(root, "src/app/(private)/layout.tsx"),
    "utf8",
  );
  const login = await readFile(
    path.join(root, "src/features/auth/login-form.tsx"),
    "utf8",
  );
  const register = await readFile(
    path.join(root, "src/features/auth/register-form.tsx"),
    "utf8",
  );
  const transcript = await readFile(
    path.join(root, "src/components/directional-text.tsx"),
    "utf8",
  );
  const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");

  assert.equal(layout.includes("use client"), false);
  assert.match(layout, /readSessionUser/);
  assert.match(layout, /redirect\("\/login"\)/);
  assert.match(login, /\/api\/v1\/auth\/login/);
  assert.match(register, /\/api\/v1\/auth\/register/);
  assert.match(transcript, /dir=/);
  assert.match(css, /margin-inline/);
  assert.match(css, /text-align:\s*start/);
});

function phoneError(phone: string): string {
  try {
    normalizePhoneNumber(phone);
  } catch (error) {
    assert.ok(error instanceof InvalidPhoneNumberError);
    return error.message;
  }
  throw new Error(`Expected an invalid phone: ${phone}`);
}

function passwordError(password: string): string {
  try {
    assertPassword(password);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  throw new Error("Expected an invalid password.");
}
