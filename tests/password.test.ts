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
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !specifier.endsWith(".ts") &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { assertPassword, hashPassword, InvalidPasswordError, verifyPassword } =
  await import("../src/server/auth/password.ts");

const password = "correct-horse-secret";

test("a correct password verifies and a wrong password fails", async () => {
  const passwordHash = await hashPassword(password);

  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(passwordHash.includes(password), false);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("wrong-horse-secret", passwordHash), false);
  assert.equal(await verifyPassword(password, "not-a-hash"), false);
});

test("password rules reject short and huge values without echoing them", () => {
  const short = "shortpw";
  const huge = "p".repeat(129);

  assert.throws(
    () => assertPassword(short),
    (error: unknown) => {
      assert.ok(error instanceof InvalidPasswordError);
      assert.equal(error.message, "Use at least 8 characters.");
      assert.equal(error.message.includes(short), false);
      return true;
    },
  );
  assert.throws(
    () => assertPassword(huge),
    (error: unknown) => {
      assert.ok(error instanceof InvalidPasswordError);
      assert.equal(error.message, "Use at most 128 characters.");
      assert.equal(error.message.includes(huge), false);
      return true;
    },
  );
  assert.doesNotThrow(() => assertPassword(password));
});
