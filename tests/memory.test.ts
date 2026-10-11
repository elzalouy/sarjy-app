import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

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

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("memory stores one JSON preference per user and key", async () => {
  const schema = await readFile(
    path.join(root, "prisma/schema.prisma"),
    "utf8",
  );
  const memoryModel = schema.match(
    /\/\/\/ One preference for one user\.[\s\S]*?@@map\("memories"\)\n\}/,
  );
  const userModel = schema.match(/model User \{[\s\S]*?\n\}/);

  assert.ok(memoryModel);
  assert.ok(userModel);
  assert.match(memoryModel[0], /A later write for that pair replaces value/);
  assert.match(memoryModel[0], /It stores no embeddings/);
  assert.match(
    memoryModel[0],
    /id\s+String\s+@id @default\(dbgenerated\("gen_random_uuid\(\)"\)\) @db\.Uuid/,
  );
  assert.match(memoryModel[0], /userId\s+String\s+@map\("user_id"\) @db\.Uuid/);
  assert.match(memoryModel[0], /key\s+String\s+@db\.VarChar\(64\)/);
  assert.match(memoryModel[0], /value\s+Json\s+@db\.JsonB/);
  assert.match(
    memoryModel[0],
    /createdAt\s+DateTime\s+@default\(now\(\)\) @map\("created_at"\) @db\.Timestamptz\(6\)/,
  );
  assert.match(
    memoryModel[0],
    /updatedAt\s+DateTime\s+@default\(now\(\)\) @updatedAt @map\("updated_at"\) @db\.Timestamptz\(6\)/,
  );
  assert.match(memoryModel[0], /onDelete:\s*Cascade/);
  assert.match(
    memoryModel[0],
    /@@unique\(\[userId, key\], map: "memories_user_id_key"\)/,
  );
  assert.match(memoryModel[0], /@@index\(\[userId\]\)/);
  assert.match(memoryModel[0], /@@map\("memories"\)/);
  assert.doesNotMatch(memoryModel[0], /\bconversationId\b/);
  assert.match(userModel[0], /memories\s+Memory\[\]/);
  assert.doesNotMatch(schema, /pgvector|vector\(/);
});

test("memory schema uses JSONB and no vector type", async () => {
  const { stdout } = await execFileAsync(
    path.join(root, "node_modules/.bin/prisma"),
    [
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.match(stdout, /CREATE TABLE "memories"/);
  assert.match(stdout, /"value" JSONB NOT NULL/);
  assert.match(stdout, /"key" VARCHAR\(64\) NOT NULL/);
  assert.match(
    stdout,
    /CREATE UNIQUE INDEX "memories_user_id_key" ON "memories"\("user_id", "key"\)/,
  );
  assert.match(
    stdout,
    /FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/,
  );
  assert.doesNotMatch(stdout, /vector|embedding|pgvector/);
});

test("memory migration links preferences to users", async () => {
  const migrationDir = path.join(root, "prisma/migrations");
  const entries = await readdir(migrationDir);
  const memoryMigration = entries.find((entry) =>
    entry.endsWith("_add_memory"),
  );
  assert.ok(memoryMigration);
  const sql = await readFile(
    path.join(migrationDir, memoryMigration, "migration.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE "memories"/);
  assert.match(sql, /"value" JSONB NOT NULL/);
  assert.match(
    sql,
    /CREATE INDEX "memories_user_id_idx" ON "memories"\("user_id"\)/,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "memories_user_id_key" ON "memories"\("user_id", "key"\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/,
  );
  assert.doesNotMatch(sql, /conversations|vector|pgvector/);
});

test("a memory row remains after the user's conversation is deleted", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    t.skip("DATABASE_URL is not set.");
    return;
  }

  const { createPrismaClient } =
    await import("../src/server/database/prisma.ts");
  const prisma = createPrismaClient(databaseUrl);
  const phone = `+1415555${String(randomInt(0, 10000)).padStart(4, "0")}`;
  const roomName = `memory-${randomInt(0, 1_000_000_000)}`;

  try {
    const user = await prisma.user.create({
      data: {
        phoneNumber: phone,
        passwordHash: "not-used-for-login",
        status: "active",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        roomName,
      },
    });
    const memory = await prisma.memory.create({
      data: {
        userId: user.id,
        key: "preferred_name",
        value: { text: "Sara" },
      },
    });

    await prisma.conversation.delete({ where: { id: conversation.id } });

    const kept = await prisma.memory.findUnique({ where: { id: memory.id } });
    assert.ok(kept);
    assert.equal(kept.userId, user.id);
    assert.equal(kept.key, "preferred_name");
    assert.deepEqual(kept.value, { text: "Sara" });

    const listed = await prisma.memory.findMany({
      where: { userId: user.id },
    });
    assert.equal(listed.length, 1);

    await assert.rejects(
      () =>
        prisma.memory.create({
          data: {
            userId: user.id,
            key: "preferred_name",
            value: { text: "Other" },
          },
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002",
    );

    await prisma.user.delete({ where: { id: user.id } });
    assert.equal(
      await prisma.memory.findUnique({ where: { id: memory.id } }),
      null,
    );
  } finally {
    await prisma.user.deleteMany({ where: { phoneNumber: phone } });
    await prisma.$disconnect();
  }
});

test("memory writes stay on the requested user", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    t.skip("DATABASE_URL is not set.");
    return;
  }

  const { createPrismaClient } =
    await import("../src/server/database/prisma.ts");
  const {
    deleteMemory,
    findMemoryForUser,
    listMemoriesForUser,
    updateMemory,
    upsertMemory,
  } = await import("../src/server/database/memories.ts");
  const prisma = createPrismaClient(databaseUrl);
  const suffix = String(randomInt(0, 10000)).padStart(4, "0");
  const ownerPhone = `+1415555${suffix}`;
  const otherPhone = `+1415556${suffix}`;

  try {
    const owner = await prisma.user.create({
      data: {
        phoneNumber: ownerPhone,
        passwordHash: "not-used-for-login",
        status: "active",
      },
    });
    const other = await prisma.user.create({
      data: {
        phoneNumber: otherPhone,
        passwordHash: "not-used-for-login",
        status: "active",
      },
    });

    const created = await upsertMemory(prisma, {
      userId: owner.id,
      key: "preferred_name",
      value: { city: "Riyadh", text: "Sara" },
    });
    assert.equal(created.created, true);
    assert.equal(created.changed, true);
    assert.equal(created.memory.userId, owner.id);

    const same = await upsertMemory(prisma, {
      userId: owner.id,
      key: "preferred_name",
      value: { text: "Sara", city: "Riyadh" },
    });
    assert.equal(same.created, false);
    assert.equal(same.changed, false);
    assert.equal(same.memory.id, created.memory.id);
    assert.equal(
      same.memory.updatedAt.getTime(),
      created.memory.updatedAt.getTime(),
    );

    const replaced = await upsertMemory(prisma, {
      userId: owner.id,
      key: "preferred_name",
      value: { text: "Sara" },
    });
    assert.equal(replaced.created, false);
    assert.equal(replaced.changed, true);
    assert.equal(replaced.memory.id, created.memory.id);
    assert.equal(
      replaced.memory.createdAt.getTime(),
      created.memory.createdAt.getTime(),
    );
    assert.deepEqual(replaced.memory.value, { text: "Sara" });

    await upsertMemory(prisma, {
      userId: owner.id,
      key: "language",
      value: "ar",
    });
    await upsertMemory(prisma, {
      userId: other.id,
      key: "preferred_name",
      value: { text: "Noor" },
    });

    const ownerRows = await listMemoriesForUser(prisma, owner.id);
    assert.deepEqual(
      ownerRows.map((row) => row.key),
      ["language", "preferred_name"],
    );
    assert.equal(
      ownerRows.every((row) => row.userId === owner.id),
      true,
    );

    const missing = await updateMemory(prisma, {
      userId: other.id,
      key: "language",
      value: "en",
    });
    assert.equal(missing, null);
    const ownerLanguage = await findMemoryForUser(prisma, {
      userId: owner.id,
      key: "language",
    });
    assert.deepEqual(ownerLanguage?.value, "ar");

    const unchanged = await updateMemory(prisma, {
      userId: owner.id,
      key: "language",
      value: "ar",
    });
    assert.equal(unchanged?.changed, false);

    const changed = await updateMemory(prisma, {
      userId: owner.id,
      key: "language",
      value: "en",
    });
    assert.equal(changed?.changed, true);
    assert.deepEqual(changed?.memory.value, "en");
    assert.equal(changed?.memory.id, ownerLanguage?.id);

    assert.equal(
      await deleteMemory(prisma, { userId: other.id, key: "language" }),
      false,
    );
    assert.equal(
      await deleteMemory(prisma, {
        userId: other.id,
        key: "preferred_name",
      }),
      true,
    );
    assert.deepEqual(
      (
        await findMemoryForUser(prisma, {
          userId: owner.id,
          key: "preferred_name",
        })
      )?.value,
      { text: "Sara" },
    );
    assert.equal(
      await findMemoryForUser(prisma, {
        userId: other.id,
        key: "preferred_name",
      }),
      null,
    );

    assert.equal(
      await deleteMemory(prisma, { userId: owner.id, key: "language" }),
      true,
    );
    assert.deepEqual(
      (await listMemoriesForUser(prisma, owner.id)).map((row) => row.key),
      ["preferred_name"],
    );
  } finally {
    await prisma.user.deleteMany({
      where: { phoneNumber: { in: [ownerPhone, otherPhone] } },
    });
    await prisma.$disconnect();
  }
});

test("memory repository rejects an invalid key or value", async () => {
  const { InvalidMemoryError, upsertMemory } =
    await import("../src/server/database/memories.ts");
  const userId = "11111111-1111-4111-8111-111111111111";
  const prisma = {} as never;

  await assert.rejects(
    () => upsertMemory(prisma, { userId, key: "", value: "Sara" }),
    InvalidMemoryError,
  );
  await assert.rejects(
    () =>
      upsertMemory(prisma, {
        userId,
        key: "x".repeat(65),
        value: "Sara",
      }),
    InvalidMemoryError,
  );
  await assert.rejects(
    () =>
      upsertMemory(prisma, {
        userId: "not-a-user",
        key: "preferred_name",
        value: "Sara",
      }),
    InvalidMemoryError,
  );
  await assert.rejects(
    () =>
      upsertMemory(prisma, {
        userId,
        key: "preferred_name",
        value: undefined as never,
      }),
    InvalidMemoryError,
  );
});

test("memory rules store a correction and reject a disallowed write", async (t) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    t.skip("DATABASE_URL is not set.");
    return;
  }

  const { createPrismaClient } =
    await import("../src/server/database/prisma.ts");
  const { MemoryRejectedError } =
    await import("../src/server/memory/policy.ts");
  const {
    correctMemoryForUser,
    forgetMemoryForUser,
    listMemoryForUser,
    rememberMemoryForUser,
  } = await import("../src/server/memory/memory-service.ts");
  const prisma = createPrismaClient(databaseUrl);
  const suffix = String(randomInt(0, 10000)).padStart(4, "0");
  const ownerPhone = `+1415557${suffix}`;
  const otherPhone = `+1415558${suffix}`;

  try {
    const owner = await prisma.user.create({
      data: {
        phoneNumber: ownerPhone,
        passwordHash: "not-used-for-login",
        status: "active",
      },
    });
    const other = await prisma.user.create({
      data: {
        phoneNumber: otherPhone,
        passwordHash: "not-used-for-login",
        status: "active",
      },
    });

    const remembered = await rememberMemoryForUser(prisma, {
      userId: owner.id,
      key: "preferred_name",
      value: "Sara",
      source: "user",
      approved: false,
    });
    assert.equal(remembered.value, "Sara");

    await assert.rejects(
      () =>
        correctMemoryForUser(prisma, {
          userId: owner.id,
          key: "city",
          value: "Riyadh",
          source: "user",
          approved: true,
        }),
      (error: unknown) =>
        error instanceof MemoryRejectedError && error.reason === "missing",
    );
    assert.equal(await prisma.memory.count({ where: { userId: owner.id } }), 1);

    const corrected = await correctMemoryForUser(prisma, {
      userId: owner.id,
      key: "preferred_name",
      value: "Noor",
      source: "user",
      approved: true,
    });
    assert.equal(corrected.key, "preferred_name");
    assert.equal(corrected.value, "Noor");
    assert.equal(await prisma.memory.count({ where: { userId: owner.id } }), 1);

    await assert.rejects(
      () =>
        rememberMemoryForUser(prisma, {
          userId: owner.id,
          key: "preferred_name",
          value: "Lina",
          source: "extracted",
          approved: false,
        }),
      (error: unknown) =>
        error instanceof MemoryRejectedError &&
        error.reason === "approval_required",
    );
    await assert.rejects(
      () =>
        forgetMemoryForUser(prisma, {
          userId: owner.id,
          key: "preferred_name",
          source: "extracted",
          approved: false,
        }),
      (error: unknown) =>
        error instanceof MemoryRejectedError &&
        error.reason === "approval_required",
    );

    await rememberMemoryForUser(prisma, {
      userId: other.id,
      key: "preferred_name",
      value: "Sara",
      source: "extracted",
      approved: true,
    });
    const ownerRows = await listMemoryForUser(prisma, owner.id);
    assert.deepEqual(
      ownerRows.map((row) => row.value),
      ["Noor"],
    );

    assert.equal(
      await forgetMemoryForUser(prisma, {
        userId: owner.id,
        key: "preferred_name",
        source: "user",
        approved: true,
      }),
      true,
    );
    assert.deepEqual(await listMemoryForUser(prisma, owner.id), []);
    assert.equal(
      (await listMemoryForUser(prisma, other.id)).map((row) => row.value)[0],
      "Sara",
    );
  } finally {
    await prisma.user.deleteMany({
      where: { phoneNumber: { in: [ownerPhone, otherPhone] } },
    });
    await prisma.$disconnect();
  }
});
