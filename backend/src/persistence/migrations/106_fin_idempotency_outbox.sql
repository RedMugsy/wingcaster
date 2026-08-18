-- Stage 1 — idempotency, outbox, approvals, authorization_attempts, usage DLQ (A §12, §6.2).

CREATE TABLE fin.approval_requests (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID REFERENCES fin.tenants(id),
  action_kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED', 'EXECUTED', 'EXPIRED'
  )),
  subject_type TEXT,
  subject_id UUID,
  payload_hash TEXT NOT NULL,
  min_distinct_approvers INTEGER NOT NULL DEFAULT 1 CHECK (min_distinct_approvers >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_approval_requests_bump_version
  BEFORE UPDATE ON fin.approval_requests
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.approval_actions (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES fin.approval_requests(id),
  actor_id UUID NOT NULL,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE fin.idempotency_keys (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID REFERENCES fin.tenants(id),
  key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED')),
  response_status INTEGER,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, tenant_id, key)
);

CREATE TRIGGER trg_idempotency_keys_bump_version
  BEFORE UPDATE ON fin.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

ALTER TABLE fin.ledger_transactions
  ADD CONSTRAINT ledger_transactions_idempotency_key_id_fkey
  FOREIGN KEY (idempotency_key_id) REFERENCES fin.idempotency_keys(id);

CREATE TABLE fin.outbox_events (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  topic TEXT NOT NULL,
  dedupe_key TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD')),
  attempts INTEGER NOT NULL,
  next_retry_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX uq_outbox_events_topic_dedupe
  ON fin.outbox_events (topic, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_outbox_events_retry
  ON fin.outbox_events (status, next_retry_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER trg_outbox_events_bump_version
  BEFORE UPDATE ON fin.outbox_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.authorization_attempts (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  holder_id UUID REFERENCES fin.holders(id),
  result TEXT NOT NULL CHECK (result IN ('AUTHORIZED', 'DENIED')),
  denial_code TEXT,
  hold_id UUID REFERENCES fin.holds(id),
  rated_usage_id UUID,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_authorization_attempts_holder
  ON fin.authorization_attempts (holder_id, created_at DESC);

CREATE TABLE fin.usage_events_dlq (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  residency_key TEXT NOT NULL,
  tenant_id UUID,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_usage_events_dlq_retry
  ON fin.usage_events_dlq (next_retry_at)
  WHERE dead_lettered_at IS NULL;

CREATE TRIGGER trg_usage_events_dlq_bump_version
  BEFORE UPDATE ON fin.usage_events_dlq
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

-- H §4 / DL-048 — two-admin cardinality. Requester cannot APPROVE.
ALTER TABLE fin.approval_requests
  ADD CONSTRAINT chk_approval_requests_action_kind CHECK (action_kind IN (
    'LARGE_GRANT', 'LARGE_REFUND', 'NEGATIVE_ADJUSTMENT', 'FACILITY_OPS',
    'BACKDATED_AMENDMENT', 'INVOICE_VOID', 'WRITE_OFF', 'RECONCILIATION_OVERRIDE',
    'MASS_OPERATION', 'PLATFORM_ADMIN_RECOVERY', 'AUDIT_RETENTION'
  ));

ALTER TABLE fin.approval_actions
  ADD CONSTRAINT chk_approval_actions_decision CHECK (decision IN ('APPROVED', 'REJECTED'));

CREATE OR REPLACE FUNCTION fin.trg_approval_request_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action_kind IN ('PLATFORM_ADMIN_RECOVERY', 'AUDIT_RETENTION', 'LARGE_REFUND') THEN
    NEW.min_distinct_approvers := GREATEST(COALESCE(NEW.min_distinct_approvers, 1), 2);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_approval_request_defaults
  BEFORE INSERT ON fin.approval_requests
  FOR EACH ROW EXECUTE FUNCTION fin.trg_approval_request_defaults();

CREATE OR REPLACE FUNCTION fin.trg_approval_action_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requester UUID;
BEGIN
  SELECT created_by_actor_id INTO requester
    FROM fin.approval_requests WHERE id = NEW.request_id;
  IF NEW.decision = 'APPROVED' AND requester IS NOT NULL AND NEW.actor_id = requester THEN
    RAISE EXCEPTION 'self-approval rejected for request %', NEW.request_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_approval_action_rules
  BEFORE INSERT ON fin.approval_actions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_approval_action_rules();

CREATE OR REPLACE FUNCTION fin.trg_approval_status_approved()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n INTEGER;
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    SELECT COUNT(DISTINCT actor_id) INTO n
      FROM fin.approval_actions
     WHERE request_id = NEW.id AND decision = 'APPROVED';
    IF n < NEW.min_distinct_approvers THEN
      RAISE EXCEPTION
        'approval % needs % distinct APPROVED actors, found %',
        NEW.id, NEW.min_distinct_approvers, n
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_approval_status_approved
  BEFORE UPDATE ON fin.approval_requests
  FOR EACH ROW EXECUTE FUNCTION fin.trg_approval_status_approved();
