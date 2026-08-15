# Testing with PostgreSQL and PostGIS

Persistence and migration tests require PostgreSQL 14 or newer with PostGIS. Unit tests remain runnable without a database and print `REQUIRES REAL POSTGRES: TEST_DATABASE_URL not set — suite not run` when database-backed suites are skipped.

## Recommended: externally provisioned PostGIS

Use a dedicated test database on Railway, Neon, Supabase, or another PostgreSQL provider with PostGIS installed. Export its connection string before running the suite:

```bash
export TEST_DATABASE_URL=postgresql://user:password@host:5432/wingcaster_test
npm run test:pg
```

The database role must be allowed to create and drop schemas. The harness calls `PostGIS_Version()` before creating test state and fails immediately if PostGIS is unavailable. PostGIS is mandatory because the market-pricing migrations define geometry columns and spatial indexes.

Use `wingcaster_test` as the database name where the provider permits selecting one. Do not point the suite at a production database.

## Local Docker alternative

From `backend/`:

```bash
npm run test:pg:docker
```

The runner starts `postgis/postgis:16-3.4` on port 5433, waits for its health check, sets `TEST_DATABASE_URL`, runs the complete Vitest suite, and removes the container and ephemeral storage. It exits with an explicit message when Docker is unavailable. Use `npm run test:pg:keep` to leave PostgreSQL running for repeated test runs.

Windows users without Bash can run:

```cmd
scripts\test-with-postgres.cmd
```

Each harness invocation creates randomized schemas for the public, area-intelligence, market-pricing, and commercial migration domains. The migration runner rewrites schema-qualified migration references into those namespaces, allowing parallel runs without sharing application tables. Teardown drops every namespace with `CASCADE`.

## CI

Start a PostGIS service container, wait until `pg_isready` succeeds, expose its connection string as `TEST_DATABASE_URL`, and run `npm test`. A 7b.1c persistence change is not eligible to merge when the database-backed suites are skipped.
