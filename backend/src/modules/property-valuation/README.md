# REB Price Index / Market Pricing

## Purpose

The Market Pricing module provides comparable-market analysis for Visitors, Agents, Agencies, and Platform Admins. It is decision support, not an appraisal, guarantee, or completed-transaction valuation.

## Architecture

- `application/analysis-service.js`: weighted robust valuation, confidence, exact cache identity, and immutable evidence runs.
- `application/comparable-service.js`: internal/external/report normalization, filters, outlier handling, recency, and similarity scores.
- `application/currency-service.js`: accepted-rate lookup, provenance, conversion, and stale-rate enforcement.
- `application/trend-service.js`: eight-quarter area/property-type snapshots, direction, volatility, and confidence.
- `application/recalculation-job-service.js`: persistent, leased, retryable recalculation jobs.
- `interface/public-routes.js`: visitor analysis, comparables, trends, and authenticated evidence reports.
- `interface/role-routes.js`: authorized Agent/Agency portfolios and auditable Keep/Adjust decisions.
- `interface/admin-routes.js`: configuration, sources, rates, reports, trends, imports, and jobs.

The module owns the `market_pricing` PostgreSQL schema and accesses the core platform only through its adapter.

## Valuation contract

1. Candidates are resolved spatially and/or by configured area and normalized to the analysis currency.
2. Ineligible, stale, and robust-statistical outliers are removed.
3. Each retained comparable receives similarity and recency weights.
4. Weighted quantiles, median, mean, target percentile, and effective sample size are calculated.
5. Confidence reflects evidence quantity/effectiveness and quality; it is not a probability of sale.
6. Each calculation writes an append-only analysis run and immutable comparable-evidence snapshot.
7. Cached analyses are reused only for the exact property/config/input identity and before expiry.

No UI should replace absent values with zero. Display `N/A` and explain unavailable analysis instead.

## Currency safety

- Fresh: rate age is at most `MARKET_PRICING_RATE_FRESH_HOURS` (default 24 hours).
- Stale but accepted: older than fresh and at most `MARKET_PRICING_RATE_MAX_STALE_HOURS` (default 7 days), with a visible warning.
- Rejected: older than the maximum or unavailable. Analysis returns `CURRENCY_RATE_UNAVAILABLE` / HTTP 503 instead of silently using a fabricated value.

Every analysis records normalized currency, rate, source, effective timestamp, age, and stale status.

## Recalculation jobs

Platform Admin can queue property, area, or all-active-listing jobs. Jobs and items are persisted. Workers atomically claim batches with `SKIP LOCKED`, use processing leases, retry transient failures with backoff, and support cancellation/retry of failed items. Duplicate active scopes coalesce.

Property lifecycle and Agent price adjustments invalidate affected cached analyses and enqueue area/property-type recalculation.

## Evidence and reporting

- Comparable reports and Agent sold-price reports require authentication.
- Sold-price reports remain pending until Platform Admin verification.
- Agent Keep/Adjust actions are written to `market_pricing.pricing_decisions` with actor, channel, analysis, old/new values, currency, and timestamp.
- Analysis history is append-only in `analysis_runs`; evidence is linked by run and is not replaced when cache entries change.

## External-source policy

Current configured providers are retained by product decision. This is not legal or compliance approval. Before enabling an external provider, Platform Admin/operations must verify:

- provider terms permit collection and valuation use;
- licensing, attribution, disclaimer, retention, and deletion obligations;
- lawful basis and applicable data-processing requirements;
- stable source identity/deduplication and monitoring;
- documented owner and periodic review date.

The Admin UI surfaces internal/external status and disclaimer/compliance responsibility.

## WhatsApp Price Health

The WhatsApp draft approval flow supports `keep_price` and `adjust_price`. Adjustment requires an explicit positive amount and `USD` or `LBP`, updates the draft, refreshes pricing context, and then returns to the existing `approve`, `approve_and_post`, `update_listing`, and `update_and_repost` confirmation IDs. Existing IDs remain backward compatible.

## Release gates

1. Apply all migrations through `026_market_pricing_hardening.sql` to a real PostgreSQL database with PostGIS.
2. Confirm geometry backfill, triggers, indexes, constraints, and all new tables.
3. Run Market Pricing and WhatsApp regressions, full typecheck, tests, lint, and production build.
4. Start API and worker; confirm readiness exposes healthy Market Pricing state.
5. Exercise visitor analysis/trends, Agent/Agency portfolios, Admin job processing, and WhatsApp Keep/Adjust against non-production data.
6. Confirm approved currency-rate and external-source operational owners before production enablement.
