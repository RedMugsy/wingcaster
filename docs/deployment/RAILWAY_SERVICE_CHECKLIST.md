# Railway Service Checklist — Wingcaster

Complete field-by-field verification list for both services. Walk through top-to-bottom; anything that doesn't match, fix it.

---

## 🔵 postgis service

### Source tab
| Field | Value |
|---|---|
| Source Image | `postgis/postgis:16-3.4` |
| Registry Credentials | **EMPTY** (delete any Username/Password — image is public) |
| Watch Paths | n/a for image deploys |

### Variables tab — exactly these 4
| Variable | Value |
|---|---|
| `POSTGRES_USER` | `wingcaster` |
| `POSTGRES_PASSWORD` | Railway-generated strong random |
| `POSTGRES_DB` | `wingcaster` |
| `PGDATA` | `/var/lib/postgresql/data/pgdata` |

No other variables on this service.

### Settings → Networking
- Public Networking: **OFF**
- Private Networking: **ON**
- Private domain: `postgis.railway.internal`

### Settings → Volumes
- Mount Path: `/var/lib/postgresql/data`
- Size: 1 GB minimum
- Attached to postgis

### Settings → Deploy
- Start Command: empty (image default)
- Healthcheck Path: empty (Postgres isn't HTTP)
- Restart Policy: ON_FAILURE, max 10
- Region: same as wingcaster

### Verification
Log should say `database system is ready to accept connections`.

---

## 🟢 wingcaster service

### Source tab
| Field | Value |
|---|---|
| Source Repo | `RedMugsy/wingcaster` |
| Root Directory | **BLANK** — `railway.json` at repo root handles Dockerfile |
| Branch | `main` |
| Auto deploys | ON |
| Wait for CI | OFF |

### Variables tab — required
| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://${{postgis.POSTGRES_USER}}:${{postgis.POSTGRES_PASSWORD}}@postgis.railway.internal:5432/${{postgis.POSTGRES_DB}}` |
| `JWT_SECRET` | 32+ char random |
| `CREDENTIALS_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `NODE_ENV` | `production` |
| `PORT` | do NOT set — Railway injects |

### Variables tab — add when features go live
- `META_APP_SECRET`
- `TIKTOK_WEBHOOK_SECRET`
- `X_WEBHOOK_SECRET`
- `TWILIO_AUTH_TOKEN`
- `SENDGRID_WEBHOOK_SECRET`
- `TWILIO_SMS_WEBHOOK_URL` or `PUBLIC_API_URL` (for Twilio behind proxy)
- AI provider keys as needed

### Variables tab — must NOT be here
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (those live on postgis)

### Settings → Build
- Builder: **Dockerfile** (force it if it says RailPack)
- Dockerfile Path: `backend/Dockerfile`
- Build Context: blank
- Watch Paths: `backend/**`

### Settings → Config-as-code
- Should say "Loaded from `railway.json`"

### Settings → Networking
- Public Networking: ON (`wingcaster-production.up.railway.app`)
- Target Port: 8080 or auto
- Private Networking: ON

### Settings → Deploy
- Start Command: empty (Dockerfile CMD)
- Healthcheck Path: `/api/health`
- Healthcheck Timeout: 60
- Restart Policy: ON_FAILURE, max 10

### Settings → Regions
Same as postgis.

---

## 🟡 Project-level checks
- Both services in same environment (`production`)
- Both services in same region
- Railway plan within quota

---

## 🔴 Log triage — if the deploy still fails

| Symptom | Cause | Fix |
|---|---|---|
| `failed to solve: ... not found` during build | Dockerfile COPY path wrong | Verify commit `9044291` or later is deploying |
| `error: extension "postgis" is not available` | DATABASE_URL still points at old plugin | Update DATABASE_URL |
| `ECONNREFUSED postgis.railway.internal:5432` | postgis down or private networking off | Redeploy postgis + verify private networking |
| `password authentication failed for user "wingcaster"` | postgis volume has stale creds from old init | Delete postgis volume + redeploy postgis |
| `database "wingcaster" does not exist` | Same stale volume | Same fix |
| `getaddrinfo ENOTFOUND postgis.railway.internal` | Private networking off / wrong service name | Service must be literally named `postgis` |
| `listening on :8080` but deploy shows failed | Healthcheck failing | `/api/health` must return 200 quickly |
