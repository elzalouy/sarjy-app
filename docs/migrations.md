# Database migrations

A schema change becomes a versioned SQL file. Commit that file with `prisma/schema.prisma`. Development and production apply those files in order.

Prisma is **7.10.0**. Run every command from the project root. Prisma loads `prisma7.config.ts`. The database URL is `DATABASE_URL`. Locally, that value is in `.env`. See [postgresql.md](postgresql.md).

There is no `prisma/migrations` folder until the first schema change. That change creates the first migration.

## Required path

Use versioned migrations only.

| Command | Where | What it does |
|---|---|---|
| `npx prisma migrate dev` | Your computer | Creates a migration from the Prisma schema and applies it to the local database. |
| `npx prisma migrate deploy` | Production and staging | Applies migrations that are already in the repository. It does not create a migration. |
| `npx prisma db push` | Nowhere | Forbidden. |

`prisma db push` copies the Prisma schema into the database and does not write a file under `prisma/migrations`. Other developers and production never receive that change. Do not use it to update a local, staging, or production database.

## What is stored

| Path | Role |
|---|---|
| `prisma/schema.prisma` | The schema you edit. |
| `prisma/migrations/<timestamp>_<name>/migration.sql` | The SQL for one change. Commit this folder. |
| `_prisma_migrations` | PostgreSQL table. Prisma records which migrations are already applied. Do not edit this table by hand. |
| `src/generated/prisma` | Generated client. Git ignores it. `npm install` runs `prisma generate`. |

## Development

Start the local database first. See [postgresql.md](postgresql.md).

### 1. Edit the schema

Change models, fields, indexes, or enums in `prisma/schema.prisma`.

### 2. Generate the migration

Create the SQL file and leave the database unchanged:

```bash
npx prisma migrate dev --name short_change_name --create-only
```

Use a short snake_case name, such as `add_user`.

Prisma writes:

```text
prisma/migrations/<timestamp>_short_change_name/migration.sql
```

`migrate dev` also creates a temporary shadow database on the same PostgreSQL server. It replays the migration history there to check that the history still applies. The local Docker user can create that database. The shadow database is not production.

### 3. Review the SQL

Open the new `migration.sql` before you apply it.

| Check | What to confirm |
|---|---|
| Matches the edit | The SQL does the change you made in `prisma/schema.prisma`. |
| Destructive SQL | Each `DROP`, type change, and rename is intentional. |
| Constraints | Unique indexes and foreign keys from the schema are in the SQL. |
| Existing rows | Current rows can survive the change. Put data conversion SQL in this file when this migration must fill or convert rows. |
| History | This file is new. An older migration folder was not edited. |

If the SQL is wrong, and this migration is not committed and not applied on a shared database, delete that new migration folder. Fix `prisma/schema.prisma`, then generate again.

If the migration is already committed, or already applied on another database, leave its SQL as it is. Add a new migration for the correction.

### 4. Apply it on your computer

```bash
npx prisma migrate dev
```

When the schema already matches the new migration, this applies pending migrations and regenerates Prisma Client.

Check the result:

```bash
npx prisma migrate status
```

The database schema is up to date when every local migration is applied.

### 5. Commit

Commit these together:

- `prisma/schema.prisma`
- the new folder under `prisma/migrations/`

Do not commit `.env` or `src/generated/prisma`.

### Apply a migration from another developer

After you pull migration files:

```bash
npx prisma migrate dev
```

This applies pending migrations on your local database and regenerates Prisma Client.

`npm install` regenerates the client from the schema. It does not change the database.

If Prisma asks to reset the database, stop and read the warning. A reset deletes local data. Run it only when that loss is acceptable:

```bash
npx prisma migrate reset
```

`migrate reset` is for your local database only.

## Production

Production and staging apply the migration files from the release. They do not create migrations.

1. The release contains `prisma/schema.prisma` and `prisma/migrations/`.
2. Set `DATABASE_URL` to that environment's database. Keep the URL in the host environment. Do not commit it.
3. From the project root, run:

```bash
npx prisma migrate deploy
```

The `prisma` package is a dev dependency. This command needs that CLI. `npm install` provides it. An install that skips dev dependencies does not.

4. Confirm the pending list is empty:

```bash
npx prisma migrate status
```

5. Start the application after `migrate deploy` succeeds.

`migrate deploy` applies pending folders in timestamp order. It does not create a migration, does not use a shadow database, and does not delete data.

| Command | Production and staging |
|---|---|
| `npx prisma migrate deploy` | This is the release command. |
| `npx prisma db push` | Forbidden. It leaves no migration file. |
| `npx prisma migrate dev` | Forbidden. It can create a migration and can ask to reset the database. |
| `npx prisma migrate reset` | Forbidden. It deletes all data in the target database. |

If `migrate deploy` fails, stop the release. Read the error before you run another command. Repair the schema with a new migration, or use `npx prisma migrate resolve` only after you know which SQL already ran. Do not mark a failed migration as applied before that check.

## Flow

```text
Edit prisma/schema.prisma
        |
        v
npx prisma migrate dev --name <name> --create-only
        |
        v
Review prisma/migrations/.../migration.sql
        |
        v
npx prisma migrate dev
        |
        v
Commit the schema and the migration folder
        |
        v
Production and staging: npx prisma migrate deploy
```
