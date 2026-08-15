# PostGIS on Railway — Setup Runbook

**Why:** Railway's default Postgres plugin uses stock `postgres:16` which does not include the PostGIS extension. Migration 023 (`area_intelligence.sql`) fails at `CREATE EXTENSION postgis`. This runbook deploys a PostGIS-enabled Postgres as a Railway service alongside the backend.

**Time:** ~15 minutes. Everything stays on Railway.

---

## Step 1 — Create the PostGIS service

1. Open the Wingcaster Railway project.
2. Click **+ New → Deploy from Docker Image**.
3. Image: `postgis/postgis:16-3.4`
4. Click **Deploy**. The service will name itself something like `postgis-postgis`. Rename it to `postgres-postgis` (Settings → Service Name).

## Step 2 — Configure environment

Go to the new service's **Variables** tab and add:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | click "Generate" — Railway generates a strong random one |
| `POSTGRES_USER` | `wingcaster` |
| `POSTGRES_DB` | `wingcaster` |
| `PGDATA` | `/var/lib/postgresql/data/pgdata` |

The `PGDATA` subpath is important — the `postgis/postgis` image expects it and it plays nicely with Railway's volume mount.

## Step 3 — Attach a persistent volume

**Critical.** Without this, every service restart wipes your database.

1. Same service → **Settings** tab → scroll to **Volumes** → **+ New Volume**.
2. Mount Path: `/var/lib/postgresql/data`
3. Size: `1 GB` (bump later if you outgrow it).
4. Save.

## Step 4 — Enable private networking

1. Settings → **Networking** → toggle **Private Networking** ON.
2. Note the internal domain that appears — something like `postgres-postgis.railway.internal`.

## Step 5 — Wait for boot, verify

1. Deployments tab → watch the log.
2. You should see: `database system is ready to accept connections`.
3. If you see `initdb: directory ... already exists`, that's fine — it means the volume was pre-populated. First-time inits print a lot; subsequent restarts print less.

## Step 6 — Create the test database

Codex needs a separate DB for real-Postgres tests. Two ways:

**Option A — Railway CLI (fastest):**
```
railway connect postgres-postgis
```
At the psql prompt:
```
CREATE DATABASE wingcaster_test;
\q
```

**Option B — via the backend service** (once it's up):
```
railway run --service <backend-service-name> psql "$DATABASE_URL" -c "CREATE DATABASE wingcaster_test;"
```

## Step 7 — Point the backend at the new DB

1. Go to your **backend service** → **Variables** tab.
2. Find `DATABASE_URL`. It's probably a reference to the old Postgres plugin (`${{Postgres.DATABASE_URL}}` or similar).
3. **Replace** with:
   ```
   postgresql://wingcaster:<POSTGRES_PASSWORD>@postgres-postgis.railway.internal:5432/wingcaster
   ```
   Substitute the password from Step 2.
   
   **Or use Railway's reference syntax** (safer — no password in plaintext in the variable):
   ```
   postgresql://wingcaster:${{postgres-postgis.POSTGRES_PASSWORD}}@postgres-postgis.railway.internal:5432/wingcaster
   ```

## Step 8 — Redeploy

1. Backend service → Deployments → **⋯ → Redeploy latest**.
2. Watch the log. You should see every migration apply, including `023_area_intelligence.sql` (which loads PostGIS), `024_market_pricing.sql`, and everything through `034` (or whatever's latest).
3. Server should reach `listening on :8080` (or whatever Railway assigned to `PORT`).
4. Hit the healthcheck: `https://wingcaster-production.up.railway.app/api/health` should return 200.

## Step 9 — Kill the old Postgres plugin

Only after Step 8 succeeds:

1. Old Postgres service → Settings → **Danger** → **Delete Service**.
2. Confirms you're no longer paying for the unused DB.

## Step 10 — Hand Codex the TEST_DATABASE_URL

Give Codex this connection string for its Prompt 12 verification:

```
postgresql://wingcaster:<POSTGRES_PASSWORD>@<railway-external-host>:<railway-external-port>/wingcaster_test
```

To get the external host + port (for testing from outside Railway's network):
- Backend service → **Networking → Public Networking → + TCP Proxy** (if you want a proxy)

Or, faster for a one-off Codex test run: use Railway's CLI proxy:
```
railway run --service postgres-postgis env | grep DATABASE_URL
```

Codex should then run its Postgres-gated tests with:
```
TEST_DATABASE_URL=postgresql://wingcaster:<pw>@localhost:<proxy-port>/wingcaster_test npm test
```

---

## Troubleshooting

**"connection refused" from the backend:**
- Verify private networking is ON for both services.
- Verify the internal hostname matches exactly (`postgres-postgis.railway.internal`).
- The postgres service must be fully booted before the backend tries to connect. If the backend deployed first, redeploy it.

**"role wingcaster does not exist":**
- Confirm `POSTGRES_USER: wingcaster` in the postgres service Variables.
- If the volume was already initialized with different creds, either destroy the volume + start fresh, OR connect and `CREATE USER wingcaster WITH PASSWORD '<pw>' SUPERUSER;`.

**"database wingcaster does not exist":**
- Same story. `CREATE DATABASE wingcaster;`.

**Migration 023 still fails with PostGIS error:**
- You're still pointed at the old Postgres. Recheck DATABASE_URL in the backend service.
- Verify with `SELECT PostGIS_Version();` in a psql session against the new DB — should return a version string.

**Backend keeps restarting after "listening":**
- Check for a healthcheck path mismatch. Our config uses `/api/health`. Verify the endpoint returns 200 quickly.
