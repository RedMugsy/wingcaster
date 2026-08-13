# Ticket 029c — Bazaar Locality Code (BLC) scheme

**Status:** Approved for build
**Parent:** [029 umbrella](./029-attribution-and-listing-identity.md)
**Blocks:** 029b (HRUUID needs BLCs to exist), sold-price registry (031), any future location-aware feature

## Purpose

A single canonical numeric identifier for every locality (country / governorate / district / city / neighborhood / village) that the platform recognizes. The BLC is the reference key used by:

- HRUUID generation (029b)
- Property `locality_id` foreign key
- Search filters ("all listings in BLC 10002")
- Area Intelligence area profiles (long-term migration path)
- Market Pricing territory partitioning
- Sold-price registry attribution
- Cross-platform reporting

Foundational reference concern that outlives ticket 029.

## Design principles

1. **Numeric only** — reads cleanly in URLs, HRUUIDs, exports, printed materials
2. **Hierarchically allocated but structurally flat** — the number is a single integer; the hierarchy is stored in the `localities` table via `parent_id`. Codes are *assigned* from range-partitioned pools so a human reader can eyeball which country group a code belongs to, but the code itself is not parsed as a hierarchy
3. **Lazy assignment** — codes are only issued when a locality is actually used; unused villages never consume codepoints
4. **Curated, never auto-generated from geocoding** — a human confirms locality identity before a BLC issues, preventing typo-driven fragmentation (`Achrafieh` vs `Ashrafiyeh`)
5. **Range-preserving** — adding countries or splitting groups never renumbers existing codes

## Format

**5-digit numeric: `CGGGG`**

- **`C`** — country group (1 digit, `0`–`9`)
- **`GGGG`** — locality within that country group (4 digits, `0000`–`9999`)

Total capacity: **100,000 codes** across all country groups. Each country group holds **10,000 codes**.

## Country group allocation

| Group | Region / country cluster | Notes |
|---|---|---|
| **0** | Reserved (special: cross-border regions, offshore, testing, migration) | Not assigned to a country at launch |
| **1** | **Lebanon** | Launch market — full sub-allocation below |
| **2** | UAE + Qatar + Bahrain + Kuwait (Gulf small) | Grouped by low individual locality count |
| **3** | Saudi Arabia | Own group — largest Gulf market |
| **4** | Egypt | |
| **5** | Jordan + Palestine + Syria (Levant expansion) | |
| **6** | Iraq | |
| **7** | Turkey | |
| **8** | North Africa (Morocco, Tunisia, Algeria, Libya) | |
| **9** | Reserved for future (Iran, Cyprus, sub-Saharan expansion) | |

**Overflow policy:** if any group approaches 90% utilization (9,000 codes assigned), allocate a secondary group from `0` or `9`. Existing codes never renumber; new localities in that country flow into the secondary range. `locality_code_ranges` table records the mapping.

## Lebanon full sub-allocation (group 1: `10000`–`19999`)

Governorate range breakdown, chosen so each governorate has room for growth and codes visually hint at governorate:

| Range | Governorate | Slots |
|---|---|---|
| `10000` | Lebanon national-level (used sparingly for "somewhere in Lebanon" listings) | 1 |
| `10001`–`10999` | **Beirut** | 999 |
| `11000`–`11999` | Mount Lebanon | 1,000 |
| `12000`–`12999` | North Lebanon | 1,000 |
| `13000`–`13999` | Akkar | 1,000 |
| `14000`–`14999` | South Lebanon | 1,000 |
| `15000`–`15999` | Nabatieh | 1,000 |
| `16000`–`16999` | Bekaa | 1,000 |
| `17000`–`17999` | Baalbek-Hermel | 1,000 |
| `18000`–`19999` | Reserved (future subdivisions, overflow) | 2,000 |

**Beirut seed allocation** (within `10001`–`10999`):

| BLC | Neighborhood |
|---|---|
| `10001` | Beirut Central District (Downtown) |
| `10002` | Achrafieh |
| `10003` | Mar Mikhael |
| `10004` | Gemmayzeh |
| `10005` | Hamra |
| `10006` | Ras Beirut |
| `10007` | Verdun |
| `10008` | Badaro |
| `10009` | Sodeco |
| `10010` | Sioufi |
| `10011` | Ain el Mreisseh |
| `10012` | Manara |
| `10013` | Rmeil |
| `10014` | Furn el Chebbak |
| `10015` | Tallet el Khayat |
| `10016` | Mazraa |
| `10017` | Ras el Nabaa |
| `10018` | Zokak el Blat |
| `10019` | Basta |
| `10020` | Bachoura |
| `10021` | Mina el Hosn |
| `10022` | Mousaitbeh |
| `10023` | Karm el Zeitoun |
| `10024` | Rmeil el Fouani |
| `10025` | Karakol el Druze |

(seed set — the remaining `10026`–`10999` fill in as neighborhoods are curated)

**Mount Lebanon starter allocation** (within `11000`–`11999`):

| BLC | Locality |
|---|---|
| `11000` | Mount Lebanon governorate-level |
| `11001` | Jounieh |
| `11002` | Kaslik |
| `11003` | Zouk Mikael |
| `11004` | Adonis |
| `11005` | Antelias |
| `11006` | Dbayeh |
| `11007` | Mansourieh |
| `11008` | Broummana |
| `11009` | Baabda |
| `11010` | Hazmieh |
| `11011` | Beit Mery |
| `11012` | Baabdat |
| `11013` | Jamhour |
| `11014` | Dekwaneh |
| `11015` | Sin el Fil |
| `11016` | Jal el Dib |
| `11017` | Zalka |
| `11018` | Bikfaya |
| `11019` | Fanar |
| `11020` | Ain Saade |

(seed set — more filled in on curation)

**North Lebanon starter** (within `12000`–`12999`):

| BLC | Locality |
|---|---|
| `12000` | North Lebanon governorate-level |
| `12001` | Tripoli |
| `12002` | Batroun |
| `12003` | Chekka |
| `12004` | Anfeh |
| `12005` | Koura |
| `12006` | Amioun |
| `12007` | Zgharta |
| `12008` | Ehden |
| `12009` | Bcharre |
| `12010` | Bsharri Cedars |

**South Lebanon starter** (within `14000`–`14999`):

| BLC | Locality |
|---|---|
| `14000` | South Lebanon governorate-level |
| `14001` | Sidon (Saida) |
| `14002` | Tyre (Sour) |
| `14003` | Jezzine |
| `14004` | Jiyeh |
| `14005` | Damour |

**Bekaa starter** (within `16000`–`16999`):

| BLC | Locality |
|---|---|
| `16000` | Bekaa governorate-level |
| `16001` | Zahle |
| `16002` | Ksara |
| `16003` | Chtaura |
| `16004` | Anjar |

All other governorate seeds are filled lazily. Full seed table lives in the migration file, versionable and auditable.

## Schema

### `localities` table (new — replaces the informal territory concept)

```sql
CREATE TABLE localities (
  id TEXT PRIMARY KEY,
  blc INTEGER UNIQUE,                          -- 5-digit Bazaar Locality Code, nullable until assigned
  blc_assigned_at TIMESTAMPTZ,
  parent_id TEXT REFERENCES localities(id) ON DELETE RESTRICT,
  level TEXT NOT NULL CHECK (level IN
    ('country','governorate','district','city','neighborhood','village')),
  iso_country CHAR(2),                         -- 'LB','AE','SA' — ISO 3166-1 alpha-2
  iso_subdivision TEXT,                        -- 'LB-BA' for Beirut governorate (ISO 3166-2)
  country_group INTEGER CHECK (country_group BETWEEN 0 AND 9),
  name TEXT NOT NULL,
  name_ar TEXT,
  name_fr TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["Ashrafieh","Achrafiyeh","Ashrafiyya"] for search
  centroid_latitude NUMERIC(10,8),
  centroid_longitude NUMERIC(11,8),
  boundary_geojson JSONB,
  parent_governorate_id TEXT REFERENCES localities(id),   -- denormalized ancestor for O(1) filter
  parent_country_id TEXT REFERENCES localities(id),
  active BOOLEAN NOT NULL DEFAULT true,
  curated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  curated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT localities_blc_range_check CHECK (
    blc IS NULL OR (blc BETWEEN 0 AND 99999)
  ),
  CONSTRAINT localities_blc_matches_group CHECK (
    blc IS NULL OR country_group IS NULL OR (blc / 10000 = country_group)
  )
);

CREATE UNIQUE INDEX uq_localities_blc ON localities(blc) WHERE blc IS NOT NULL;
CREATE INDEX idx_localities_parent ON localities(parent_id);
CREATE INDEX idx_localities_country ON localities(iso_country);
CREATE INDEX idx_localities_group ON localities(country_group);
CREATE INDEX idx_localities_governorate ON localities(parent_governorate_id) WHERE parent_governorate_id IS NOT NULL;
CREATE INDEX idx_localities_active ON localities(active) WHERE active;
CREATE INDEX idx_localities_name_lower ON localities((lower(name)));

-- Search over aliases
CREATE INDEX idx_localities_aliases_gin ON localities USING GIN (aliases);
```

### `locality_code_ranges` table (allocation policy — auditable and evolvable)

```sql
CREATE TABLE locality_code_ranges (
  id TEXT PRIMARY KEY,
  country_group INTEGER NOT NULL CHECK (country_group BETWEEN 0 AND 9),
  range_start INTEGER NOT NULL CHECK (range_start BETWEEN 0 AND 99999),
  range_end INTEGER NOT NULL CHECK (range_end BETWEEN 0 AND 99999),
  label TEXT NOT NULL,                         -- 'Lebanon / Beirut' or 'UAE / Dubai'
  countries JSONB NOT NULL,                    -- ["LB"] or ["AE","QA","BH","KW"]
  governorate_id TEXT REFERENCES localities(id),  -- present when range is governorate-scoped
  reserved BOOLEAN NOT NULL DEFAULT false,
  utilization_alert_threshold_pct INTEGER NOT NULL DEFAULT 90,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT locality_ranges_valid_bounds CHECK (range_start <= range_end),
  CONSTRAINT locality_ranges_group_match CHECK (
    range_start / 10000 = country_group AND range_end / 10000 = country_group
  )
);

-- Prevent overlapping ranges within the same country group
CREATE UNIQUE INDEX uq_locality_ranges_no_overlap
  ON locality_code_ranges USING GIST (
    country_group WITH =,
    int4range(range_start, range_end + 1) WITH &&
  );
```

### `properties` — add locality reference

```sql
ALTER TABLE properties
  ADD COLUMN locality_id TEXT REFERENCES localities(id) ON DELETE SET NULL,
  ADD COLUMN locality_blc INTEGER;  -- denormalized for fast filter/aggregation

CREATE INDEX idx_properties_locality_id ON properties(locality_id);
CREATE INDEX idx_properties_locality_blc ON properties(locality_blc);
```

## BLC assignment procedure

Encapsulated in `backend/src/lib/localities/allocator.js`:

```
allocateBLC(locality_id):
  1. Load locality, verify curated_by IS NOT NULL (no auto-allocation for unverified)
  2. Determine target range:
       a. If locality.parent_governorate_id has a specific range in locality_code_ranges, use it
       b. Else fall back to country_group range (10000-19999 for Lebanon, etc.)
  3. SELECT MAX(blc) FROM localities WHERE blc BETWEEN range_start AND range_end
  4. next_blc = max + 1
  5. If next_blc > range_end → RAISE and log locality_range_pressure_event
  6. UPDATE localities SET blc = next_blc, blc_assigned_at = now() WHERE id = locality_id
  7. If assigned count / range_size > alert_threshold_pct → notify admin (soft alert)
```

Wrapped in a transaction with `SELECT ... FOR UPDATE` on `locality_code_ranges` row to prevent concurrent allocations from colliding.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/localities` | none | Search by name, alias, iso_country, or level |
| `GET` | `/api/localities/:id_or_blc` | none | Fetch single locality with parent chain |
| `GET` | `/api/localities/:id/children` | none | List children |
| `GET` | `/api/localities/tree/:iso_country` | none | Full tree for a country |
| `POST` | `/api/admin/localities` | platform_admin | Create locality (curated) |
| `POST` | `/api/admin/localities/:id/allocate-blc` | platform_admin | Explicitly issue a BLC for a curated locality |
| `PATCH` | `/api/admin/localities/:id` | platform_admin | Edit metadata (name, aliases, boundary) |
| `POST` | `/api/admin/localities/:id/merge` | platform_admin | Merge duplicate into canonical (aliases preserved) |
| `GET` | `/api/admin/locality-code-ranges` | platform_admin | List allocation policy |
| `POST` | `/api/admin/locality-code-ranges` | platform_admin | Allocate a new range (e.g. new country) |

## Seed migration

Migration file `031_locality_code_scheme.sql` (numbered before 029 in the rollout order — see umbrella):

1. Create `localities` and `locality_code_ranges` tables
2. Seed country entries for Lebanon, UAE, Qatar, Bahrain, Kuwait, KSA, Egypt, Jordan, Palestine, Syria, Iraq, Turkey, Morocco, Tunisia, Algeria, Libya (all levels: country)
3. Seed 8 Lebanese governorate entries with BLCs `10000` (national), `11000`, `12000`, `13000`, `14000`, `15000`, `16000`, `17000`
4. Seed the Beirut/Mount Lebanon/North/South/Bekaa starter neighborhood BLCs listed above
5. Seed `locality_code_ranges` rows for every group + Lebanon's governorate sub-ranges
6. Backfill: for existing properties, best-effort match `properties.city` + `properties.neighborhood` against `localities.name` + `aliases`; populate `locality_id` and `locality_blc` where a confident match exists. Non-matching rows stay NULL and are surfaced via the pre-migration hygiene script for curator review.

## Interaction with existing `territories` table

The pre-M028 `territories` table (`code = 'territory-lb'`) becomes legacy:

- Retained for backward compatibility of `properties.territory_id`
- New code reads and writes go through `localities`
- After 60 days of clean traffic on the new path, `territories` can be dropped in a follow-up migration
- Not blocking for 029 rollout — this is a soft transition

## Pre-migration hygiene script

New: `backend/scripts/pre-migration-029c-check.js` (follows the pattern of `pre-migration-027-028-check.js`):

- Enumerate every distinct `(city, neighborhood)` pair in `properties`
- For each pair, attempt fuzzy match against seeded localities + aliases
- Report:
  - Confident matches (will auto-backfill)
  - Ambiguous matches (curator picks)
  - No match (curator either creates new locality or maps to existing via alias)
- Zero code changes to production until curator has reviewed the ambiguous set

## Files touched

**Backend:**
- `backend/src/persistence/migrations/031_locality_code_scheme.sql` (new; runs before 029)
- `backend/scripts/pre-migration-029c-check.js` (new)
- New: `backend/src/lib/localities/allocator.js` — BLC allocation logic with FOR UPDATE
- New: `backend/src/lib/localities/index.js` — CRUD + search
- New: `backend/src/lib/localities/matcher.js` — fuzzy name/alias match for property backfill
- `backend/src/server.js` — new `/api/localities/*` and `/api/admin/localities/*` routes
- `backend/src/persistence/table-mapper.js` — register `localities`, `locality_code_ranges`; add locality columns to properties mapping
- `backend/src/lib/validation.js` — schema for locality create/update payloads

**No frontend changes required in this ticket** — locality picker UI is a follow-up (part of the property-create form redesign).

## Environment variables

None specific to this ticket.

## Testing

- Allocator: concurrent BLC allocation under contention (10 workers, single range) — no duplicates, no gaps unless range full
- Overflow: fill a range to 9999, next allocation raises with clear "range_pressure" error
- Range constraints: attempt to insert BLC 20001 with country_group=1 → rejected by CHECK
- Range overlap: insert two ranges 11000-11500 and 11400-11800 in same country group → rejected by GIST unique constraint
- Matcher: "Ashrafiyeh" fuzzy-matches "Achrafieh" via aliases with confidence ≥ 0.9
- Backfill: run against a seed of 100 properties with dirty city/neighborhood strings, verify high-confidence matches auto-fill and low-confidence surface as ambiguous

## Rollout

1. Ship migration `031_locality_code_scheme.sql` in isolation (Beirut/Mount Lebanon seeds live; other governorates seed on demand)
2. Run pre-migration hygiene check against production; curator reviews ambiguous property matches
3. Run backfill for confidently-matched properties
4. Ship 029b (HRUUID) which now has BLCs to reference
5. Ongoing: curators add new localities as market expansion demands, allocator issues BLCs on demand

## Success metrics

- 100% of new properties get a `locality_id` on create (validation-enforced)
- ≥ 90% of pre-existing properties successfully backfilled to a locality
- Zero BLC collisions across all history
- Zero code violations of country_group / BLC prefix consistency (CHECK constraints enforce)
- BLC allocation latency p95 < 50ms

## Related documents

- [029 umbrella](./029-attribution-and-listing-identity.md)
- [029b listing HRUUID + PKI](./029b-listing-hrid-and-pki.md) — depends on this ticket
- [Tenant view model architecture](../tenant-view-model-architecture.md) — locality is the "asset location" axis
