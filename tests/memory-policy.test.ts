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

const {
  allowedMemoryKeys,
  memoryRejectMessage,
  memoryValueLimits,
  reviewMemoryRemoval,
  reviewMemoryWrite,
} = await import("../src/server/memory/policy.ts");
const { MemoryRejectedError } = await import("../src/server/memory/policy.ts");
const { correctMemoryForUser, forgetMemoryForUser, rememberMemoryForUser } =
  await import("../src/server/memory/memory-service.ts");

const userId = "11111111-1111-4111-8111-111111111111";

test("memory policy allows only profile keys inside their limits", () => {
  assert.deepEqual(allowedMemoryKeys, ["city", "language", "preferred_name"]);
  assert.equal(memoryValueLimits.preferred_name, 40);
  assert.equal(memoryValueLimits.city, 80);

  const name = reviewMemoryWrite({
    key: "preferred_name",
    value: "  Sara   Ali  ",
    source: "user",
    approved: false,
  });
  assert.deepEqual(name, {
    ok: true,
    key: "preferred_name",
    value: "Sara Ali",
  });

  const language = reviewMemoryWrite({
    key: "language",
    value: " EN ",
    source: "user",
    approved: false,
  });
  assert.deepEqual(language, { ok: true, key: "language", value: "en" });

  const city = reviewMemoryWrite({
    key: "city",
    value: "Riyadh",
    source: "extracted",
    approved: true,
  });
  assert.deepEqual(city, { ok: true, key: "city", value: "Riyadh" });
});

test("disallowed, oversized, extracted, and sensitive memory writes are rejected", () => {
  const secret = "password hunter2";
  const cases = [
    {
      key: "password",
      value: "Sara",
      source: "user",
      approved: true,
      reason: "disallowed_key",
    },
    {
      key: "phone_number",
      value: "+14155552671",
      source: "user",
      approved: true,
      reason: "disallowed_key",
    },
    {
      key: "preferred_name",
      value: "a".repeat(41),
      source: "user",
      approved: true,
      reason: "invalid_value",
    },
    {
      key: "language",
      value: "fr",
      source: "user",
      approved: true,
      reason: "invalid_value",
    },
    {
      key: "preferred_name",
      value: { text: "Sara" },
      source: "user",
      approved: true,
      reason: "invalid_value",
    },
    {
      key: "preferred_name",
      value: secret,
      source: "user",
      approved: true,
      reason: "sensitive",
    },
    {
      key: "city",
      value: "sara@example.com",
      source: "user",
      approved: true,
      reason: "sensitive",
    },
    {
      key: "preferred_name",
      value: "+1 415 555 2671",
      source: "user",
      approved: true,
      reason: "sensitive",
    },
    {
      key: "preferred_name",
      value: "4111 1111 1111 1111",
      source: "user",
      approved: true,
      reason: "sensitive",
    },
    {
      key: "preferred_name",
      value: "Sara",
      source: "extracted",
      approved: false,
      reason: "approval_required",
    },
  ] as const;

  for (const item of cases) {
    const review = reviewMemoryWrite(item);
    assert.deepEqual(review, { ok: false, reason: item.reason });
    assert.equal(JSON.stringify(review).includes(secret), false);
    assert.equal(memoryRejectMessage(item.reason).includes(secret), false);
    assert.equal(memoryRejectMessage(item.reason).includes("4111"), false);
  }

  const removal = reviewMemoryRemoval({
    key: "preferred_name",
    source: "extracted",
    approved: false,
  });
  assert.deepEqual(removal, { ok: false, reason: "approval_required" });
});

test("rejected memory writes do not reach the database", async () => {
  const prisma = new Proxy(
    {},
    {
      get() {
        throw new Error("database was called");
      },
    },
  ) as never;

  await assert.rejects(
    () =>
      rememberMemoryForUser(prisma, {
        userId,
        key: "api_key",
        value: "secret-value",
        source: "user",
        approved: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MemoryRejectedError);
      assert.equal(error.reason, "disallowed_key");
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    },
  );
  await assert.rejects(
    () =>
      correctMemoryForUser(prisma, {
        userId,
        key: "preferred_name",
        value: "Sara",
        source: "extracted",
        approved: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MemoryRejectedError);
      assert.equal(error.reason, "approval_required");
      return true;
    },
  );
  await assert.rejects(
    () =>
      forgetMemoryForUser(prisma, {
        userId,
        key: "credit_card",
        source: "user",
        approved: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MemoryRejectedError);
      assert.equal(error.reason, "disallowed_key");
      return true;
    },
  );
});
