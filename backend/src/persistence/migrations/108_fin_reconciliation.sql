-- Stage 1 — reconciliation suite (A §12.6, F §1 / DL-045 / DL-046).

CREATE TABLE fin.reconciliation_runs (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'RUNNING', 'GREEN', 'DRIFT', 'ERROR', 'CANCELED'
  )),
  schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('DAILY', 'PER_CLOSE', 'ON_DEMAND')),
  advisory_lock_key TEXT NOT NULL,
  triggered_by_actor_type TEXT,
  triggered_by_actor_id UUID,
  legal_entity_id UUID REFERENCES fin.platform_legal_entities(id),
  billing_period_id UUID,
  accounting_period_id UUID,
  source_system TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_reconciliation_runs_bump_version
  BEFORE UPDATE ON fin.reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.reconciliation_checks (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES fin.reconciliation_runs(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  check_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  result TEXT NOT NULL CHECK (result IN ('GREEN', 'DRIFT', 'ERROR')),
  source_query_ref TEXT,
  comparison_query_ref TEXT,
  expected_delta_units BIGINT NOT NULL,
  observed_delta_units BIGINT,
  drift_action TEXT,
  advisory_lock_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE fin.reconciliation_drift (
  id UUID PRIMARY KEY,
  check_id UUID NOT NULL REFERENCES fin.reconciliation_checks(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  expected JSONB NOT NULL,
  actual JSONB NOT NULL,
  delta JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE fin.reconciliation_resolution (
  id UUID PRIMARY KEY,
  drift_id UUID NOT NULL REFERENCES fin.reconciliation_drift(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  action TEXT NOT NULL CHECK (action IN (
    'WARN', 'BLOCK_NEW_ISSUANCE', 'BLOCK_AFFECTED_HOLDER',
    'BLOCK_AFFECTED_BOOK', 'BLOCK_BILLING_CLOSE'
  )),
  approval_request_id UUID REFERENCES fin.approval_requests(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_reconciliation_resolution_bump_version
  BEFORE UPDATE ON fin.reconciliation_resolution
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();
