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

const { InvalidPhoneNumberError, normalizePhoneNumber } =
  await import("../src/server/shared/phone-number.ts");
const { findUserByPhone } = await import("../src/server/database/users.ts");

test("equivalent phone formats map to one canonical number", () => {
  const usFormats = [
    "+14155552671",
    "+1 415 555 2671",
    "+1 (415) 555-2671",
    "+1.415.555.2671",
    "0014155552671",
    "00 1 415 555 2671",
    "  +1 415 555 2671  ",
  ];
  for (const format of usFormats) {
    assert.equal(normalizePhoneNumber(format), "+14155552671");
  }

  const saFormats = [
    "+966512345678",
    "+966 51 234 5678",
    "+966-51-234-5678",
    "00966512345678",
    "00 966 51 234 5678",
  ];
  for (const format of saFormats) {
    assert.equal(normalizePhoneNumber(format), "+966512345678");
  }
});

test("malformed phone numbers are rejected without echoing the input", () => {
  const secret = "secret-phone-value";
  const rejected = [
    "",
    "   ",
    "4155552671",
    "14155552671",
    "+1",
    "+1234567",
    "+1234567890123456",
    "+0123456789",
    "++14155552671",
    "+1 415 555 2671 x12",
    `+1 ${secret}`,
    "abc",
    "+1-415-CALL",
  ];

  for (const input of rejected) {
    assert.throws(
      () => normalizePhoneNumber(input),
      (error: unknown) => {
        assert.ok(error instanceof InvalidPhoneNumberError);
        assert.equal(
          error.message,
          "Enter a valid phone number with a country code.",
        );
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  }
});

test("a phone lookup normalizes before it queries", async () => {
  const seen: string[] = [];
  const prisma = {
    user: {
      findUnique: async (args: { where: { phoneNumber: string } }) => {
        seen.push(args.where.phoneNumber);
        return null;
      },
    },
  };

  const found = await findUserByPhone(prisma as never, "+1 (415) 555-2671");
  assert.equal(found, null);
  assert.deepEqual(seen, ["+14155552671"]);

  await assert.rejects(
    () => findUserByPhone(prisma as never, "4155552671"),
    InvalidPhoneNumberError,
  );
  assert.deepEqual(seen, ["+14155552671"]);
});
