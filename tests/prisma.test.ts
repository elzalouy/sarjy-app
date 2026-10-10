import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("Prisma 7.10.0 is pinned and no other ORM is installed", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const lockfile = JSON.parse(
    await readFile(path.join(root, "package-lock.json"), "utf8"),
  ) as {
    packages: Record<
      string,
      {
        version?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }
    >;
  };

  assert.equal(packageJson.dependencies["@prisma/client"], "7.10.0");
  assert.equal(packageJson.dependencies["@prisma/adapter-pg"], "7.10.0");
  assert.equal(packageJson.dependencies.pg, "8.23.1");
  assert.equal(packageJson.devDependencies.prisma, "7.10.0");
  assert.equal(packageJson.devDependencies.dotenv, "18.0.7");
  assert.equal(
    lockfile.packages[""]?.dependencies?.["@prisma/client"],
    "7.10.0",
  );
  assert.equal(
    lockfile.packages[""]?.dependencies?.["@prisma/adapter-pg"],
    "7.10.0",
  );
  assert.equal(lockfile.packages[""]?.dependencies?.pg, "8.23.1");
  assert.equal(lockfile.packages[""]?.devDependencies?.prisma, "7.10.0");
  assert.equal(lockfile.packages[""]?.devDependencies?.dotenv, "18.0.7");
  assert.equal(lockfile.packages["node_modules/prisma"]?.version, "7.10.0");
  assert.equal(
    lockfile.packages["node_modules/@prisma/client"]?.version,
    "7.10.0",
  );
  assert.equal(
    lockfile.packages["node_modules/@prisma/adapter-pg"]?.version,
    "7.10.0",
  );

  const directNames = [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies),
  ];
  assert.deepEqual(
    directNames.filter((name) =>
      /^(drizzle-orm|typeorm|sequelize|knex|mongoose|@prisma\/orm-)/.test(name),
    ),
    [],
  );
});

test("Prisma schema uses PostgreSQL and the version 7 client generator", async () => {
  const schema = await readFile(
    path.join(root, "prisma/schema.prisma"),
    "utf8",
  );
  const config = await readFile(path.join(root, "prisma7.config.ts"), "utf8");

  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.match(schema, /provider\s*=\s*"prisma-client"/);
  assert.match(schema, /output\s*=\s*"\.\.\/src\/generated\/prisma"/);
  assert.match(config, /import "dotenv\/config"/);
  assert.match(config, /schema:\s*"prisma\/schema\.prisma"/);
  assert.match(config, /path:\s*"prisma\/migrations"/);
  assert.match(config, /process\.env\["DATABASE_URL"\]/);
});

test("User schema stores a unique normalized phone number", async () => {
  const schema = await readFile(
    path.join(root, "prisma/schema.prisma"),
    "utf8",
  );
  const userModel = schema.match(/model User \{[\s\S]*?\n\}/);
  const accountStatus = schema.match(/enum AccountStatus \{[\s\S]*?\n\}/);

  assert.ok(userModel);
  assert.ok(accountStatus);
  assert.match(
    userModel[0],
    /id\s+String\s+@id @default\(dbgenerated\("gen_random_uuid\(\)"\)\) @db\.Uuid/,
  );
  assert.match(
    userModel[0],
    /phoneNumber\s+String\s+@unique @map\("phone_number"\) @db\.VarChar\(16\)/,
  );
  assert.match(userModel[0], /passwordHash\s+String\s+@map\("password_hash"\)/);
  assert.match(userModel[0], /status\s+AccountStatus\s+@default\(active\)/);
  assert.match(
    userModel[0],
    /createdAt\s+DateTime\s+@default\(now\(\)\) @map\("created_at"\) @db\.Timestamptz\(6\)/,
  );
  assert.match(
    userModel[0],
    /updatedAt\s+DateTime\s+@default\(now\(\)\) @updatedAt @map\("updated_at"\) @db\.Timestamptz\(6\)/,
  );
  assert.match(userModel[0], /@@map\("users"\)/);
  assert.match(accountStatus[0], /\bactive\b/);
  assert.match(accountStatus[0], /\bdisabled\b/);
  assert.match(accountStatus[0], /@@map\("account_status"\)/);
});

test("User phone uniqueness is a database unique index", async () => {
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

  assert.match(
    stdout,
    /CREATE UNIQUE INDEX "users_phone_number_key" ON "users"\("phone_number"\)/,
  );
});

test("generated Prisma Client can be constructed", async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://sarjy:sarjy@127.0.0.1:1/sarjy",
    }),
  });

  assert.equal(typeof prisma.$disconnect, "function");
  await prisma.$disconnect();
});

test("Prisma 7.10 uses migrate dev and migrate deploy", async () => {
  const { stdout } = await execFileAsync(
    path.join(root, "node_modules/.bin/prisma"),
    ["migrate", "--help"],
    { cwd: root, encoding: "utf8" },
  );

  assert.match(
    stdout,
    /dev\s+Create a migration from changes in Prisma schema, apply it to the database/,
  );
  assert.match(stdout, /trigger generators/);
  assert.match(stdout, /deploy\s+Apply pending migrations to the database/);
  assert.match(stdout, /reset\s+Reset your database and apply all migrations/);
});
