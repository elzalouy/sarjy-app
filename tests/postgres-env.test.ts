import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const localDatabaseUrl = "postgresql://sarjy:sarjy@127.0.0.1:5433/sarjy";

test("Docker Compose and the database doc use PostgreSQL 18.6", async () => {
  const compose = await readFile(path.join(root, "docker-compose.yml"), "utf8");
  const doc = await readFile(path.join(root, "docs/postgresql.md"), "utf8");
  const example = await readFile(path.join(root, ".env.example"), "utf8");

  assert.match(compose, /image:\s*postgres:18\.6/);
  assert.match(compose, /127\.0\.0\.1:5433:5432/);
  assert.match(compose, /POSTGRES_USER:\s*sarjy/);
  assert.match(compose, /POSTGRES_DB:\s*sarjy/);
  assert.match(compose, /POSTGRES_PASSWORD:\s*sarjy/);
  assert.match(compose, /sarjy-postgres:\/var\/lib\/postgresql\s*$/m);
  assert.match(doc, /18\.6/);
  assert.match(doc, new RegExp(localDatabaseUrl.replaceAll("/", "\\/")));
  assert.match(
    example,
    new RegExp(`DATABASE_URL=${localDatabaseUrl.replaceAll("/", "\\/")}`),
  );
});
