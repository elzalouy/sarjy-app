# Local PostgreSQL

Use the Docker Compose database in this repository. Do not depend on a PostgreSQL install that is already on one computer. That install can use a different version and a different port.

## Version

PostgreSQL **18.6**. The Docker image is `postgres:18.6`.

## Connection

| Setting | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` |
| Database | `sarjy` |
| User | `sarjy` |
| Password | `sarjy` |
| Connection string | `postgresql://sarjy:sarjy@127.0.0.1:5433/sarjy` |

The app reads this string from `DATABASE_URL`. The same value is in `.env.example`.

Port `5433` is on your computer. Inside Docker, PostgreSQL still uses port `5432`. Port `5433` avoids a clash when another PostgreSQL is already using port `5432`.

The password `sarjy` is only for this local database. Do not use it in production.

## Start

1. Install Docker.
2. In the project folder, run:

```bash
docker compose up -d
```

3. Wait until the service is healthy:

```bash
docker compose ps
```

The status should include `healthy`.

## Check

```bash
docker compose exec postgres psql -U sarjy -d sarjy -c "SELECT version();"
```

You should see PostgreSQL 18.6.

## Stop

```bash
docker compose stop
```

This stops the database and keeps its data.

## Remove local data

```bash
docker compose down -v
```

This deletes the local database volume. The next start creates an empty database.

## Schema changes

Change the database with a versioned migration. The steps are in [migrations.md](migrations.md).

`npx prisma db push` is not a migration. Do not use it to update this database.
