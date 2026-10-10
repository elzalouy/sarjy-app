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

const { createPrismaClient } = await import("../src/server/database/prisma.ts");
const {
  DatabaseConnectionError,
  checkDatabaseConnection,
  databaseConnectionCodes,
  verifyDatabaseConnection,
} = await import("../src/server/database/connectivity.ts");

const root = path.resolve(import.meta.dirname, "..");
const localDatabaseUrl = "postgresql://sarjy:sarjy@127.0.0.1:5433/sarjy";
const secretPassword = "super-secret-db-password";
const refusedUrl = `postgresql://sarjy:${secretPassword}@127.0.0.1:1/sarjy`;

test("database modules stay on the server", async () => {
  const prismaSource = await readFile(
    path.join(root, "src/server/database/prisma.ts"),
    "utf8",
  );
  const connectivitySource = await readFile(
    path.join(root, "src/server/database/connectivity.ts"),
    "utf8",
  );

  assert.match(prismaSource, /^import "server-only";/m);
  assert.match(connectivitySource, /^import "server-only";/m);
});

test("connection failures return safe diagnostics", async () => {
  const client = createPrismaClient(refusedUrl);
  try {
    const result = await checkDatabaseConnection(client);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.code, databaseConnectionCodes.connectionRefused);
    assert.equal(
      result.message,
      "The database refused the connection. Check that PostgreSQL is running.",
    );

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(secretPassword), false);
    assert.equal(serialized.includes("postgresql://"), false);
    assert.equal(serialized.includes(refusedUrl), false);
    assert.match(result.message, /^[A-Za-z0-9 .:_/-]+$/);
  } finally {
    await client.$disconnect();
  }
});

test("startup verifies the database only on the Node.js server", async () => {
  const source = await readFile(
    path.join(root, "src/instrumentation.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /^import\s+.*server\/database\/connectivity/m);
  assert.match(source, /NEXT_RUNTIME !== "nodejs"/);
  assert.match(source, /verifyDatabaseConnection/);
});

test("startup verification throws a safe connection error", async () => {
  await assert.rejects(
    verifyDatabaseConnection({
      $queryRaw: async () => {
        throw new Error(
          `Can't reach database server at 127.0.0.1:1 password=${secretPassword}`,
        );
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseConnectionError);
      assert.equal(error.code, databaseConnectionCodes.unknown);
      assert.equal(error.message.includes(secretPassword), false);
      assert.equal(error.message.includes("127.0.0.1"), false);
      return true;
    },
  );
});

test("adapter auth failures hide driver text", async () => {
  const result = await checkDatabaseConnection({
    $queryRaw: async () => {
      throw {
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: {
              kind: "AuthenticationFailed",
              originalCode: "28P01",
              originalMessage: `password authentication failed for user "sarjy" ${secretPassword}`,
              user: "sarjy",
            },
          },
        },
      };
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, databaseConnectionCodes.authFailed);
  assert.equal(
    result.message,
    "The database rejected the credentials. Check DATABASE_URL.",
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secretPassword), false);
  assert.equal(serialized.includes("28P01"), false);
  assert.equal(serialized.includes("sarjy"), false);
});

test("a successful connection is verified with SELECT 1", async (t) => {
  const client = createPrismaClient(
    process.env.DATABASE_URL?.trim() || localDatabaseUrl,
  );
  try {
    const result = await checkDatabaseConnection(client);
    if (
      !result.ok &&
      (result.code === databaseConnectionCodes.connectionRefused ||
        result.code === databaseConnectionCodes.hostUnreachable ||
        result.code === databaseConnectionCodes.timeout)
    ) {
      t.skip(
        "PostgreSQL is not reachable. Start it with: docker compose up -d",
      );
      return;
    }

    assert.deepEqual(result, { ok: true });
  } finally {
    await client.$disconnect();
  }
});
