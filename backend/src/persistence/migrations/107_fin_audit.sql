-- Stage 1 — financial_audit_events hash-chain (A §12.5, H §3, DL-008 / DL-044).

CREATE TABLE fin.financial_audit_events (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  actor_type TEXT NOT NULL,
  actor_id UUID,
  actor_email_snapshot TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  before_state JSONB,
  after_state JSONB,
  reason_code TEXT,
  approval_request_id UUID REFERENCES fin.approval_requests(id),
  request_id TEXT,
  ip TEXT,
  user_agent TEXT,
  prev_hash TEXT NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash TEXT NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_financial_audit_events_target
  ON fin.financial_audit_events (target_type, target_id, created_at);

-- RFC 8785 JCS subset used by the chain (H §3). Nested JSONB is re-canonicalized.
CREATE OR REPLACE FUNCTION fin.json_canonical(j JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k TEXT;
  parts TEXT[] := ARRAY[]::TEXT[];
  i INTEGER;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) = 'null' THEN
    RETURN 'null';
  ELSIF jsonb_typeof(j) = 'bool' THEN
    RETURN j::text;
  ELSIF jsonb_typeof(j) = 'number' THEN
    RETURN j::text;
  ELSIF jsonb_typeof(j) = 'string' THEN
    RETURN to_json(j #>> '{}')::text;
  ELSIF jsonb_typeof(j) = 'array' THEN
    IF jsonb_array_length(j) = 0 THEN
      RETURN '[]';
    END IF;
    FOR i IN 0 .. jsonb_array_length(j) - 1 LOOP
      parts := parts || fin.json_canonical(j -> i);
    END LOOP;
    RETURN '[' || array_to_string(parts, ',') || ']';
  ELSIF jsonb_typeof(j) = 'object' THEN
    FOR k IN SELECT key FROM jsonb_object_keys(j) AS key ORDER BY key
    LOOP
      parts := parts || (to_json(k)::text || ':' || fin.json_canonical(j -> k));
    END LOOP;
    RETURN '{' || array_to_string(parts, ',') || '}';
  END IF;
  RAISE EXCEPTION 'unknown jsonb type %', jsonb_typeof(j);
END;
$$;

CREATE OR REPLACE FUNCTION fin.jcs_format_timestamp(ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

CREATE OR REPLACE FUNCTION fin.audit_row_canonical(
  p_id UUID,
  p_environment TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_actor_email_snapshot TEXT,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id UUID,
  p_before_state JSONB,
  p_after_state JSONB,
  p_reason_code TEXT,
  p_approval_request_id UUID,
  p_request_id TEXT,
  p_created_at TIMESTAMPTZ,
  p_prev_hash TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT fin.json_canonical(jsonb_build_object(
    'action', p_action,
    'actor_email_snapshot', p_actor_email_snapshot,
    'actor_id', to_jsonb(lower(p_actor_id::text)),
    'actor_type', p_actor_type,
    'after_state', p_after_state,
    'approval_request_id', to_jsonb(lower(p_approval_request_id::text)),
    'before_state', p_before_state,
    'created_at', fin.jcs_format_timestamp(p_created_at),
    'environment', p_environment,
    'id', lower(p_id::text),
    'prev_hash', p_prev_hash,
    'reason_code', p_reason_code,
    'request_id', p_request_id,
    'target_id', to_jsonb(lower(p_target_id::text)),
    'target_type', p_target_type
  ));
$$;

-- jsonb_build_object drops keys whose value expression is NULL SQL (not JSON
-- null). Re-add hashed nulls so the field list is always complete (A §12.5).
CREATE OR REPLACE FUNCTION fin.audit_payload_json(
  p_id UUID,
  p_environment TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_actor_email_snapshot TEXT,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id UUID,
  p_before_state JSONB,
  p_after_state JSONB,
  p_reason_code TEXT,
  p_approval_request_id UUID,
  p_request_id TEXT,
  p_created_at TIMESTAMPTZ,
  p_prev_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN jsonb_build_object(
    'action', p_action,
    'actor_email_snapshot', p_actor_email_snapshot,
    'actor_id', CASE WHEN p_actor_id IS NULL THEN NULL::text ELSE lower(p_actor_id::text) END,
    'actor_type', p_actor_type,
    'after_state', p_after_state,
    'approval_request_id', CASE WHEN p_approval_request_id IS NULL THEN NULL::text ELSE lower(p_approval_request_id::text) END,
    'before_state', p_before_state,
    'created_at', fin.jcs_format_timestamp(p_created_at),
    'environment', p_environment,
    'id', lower(p_id::text),
    'prev_hash', p_prev_hash,
    'reason_code', p_reason_code,
    'request_id', p_request_id,
    'target_id', CASE WHEN p_target_id IS NULL THEN NULL::text ELSE lower(p_target_id::text) END,
    'target_type', p_target_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION fin.trg_financial_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
DECLARE
  tail TEXT;
BEGIN
  -- Serialize concurrent inserts in one environment (empty-table race too).
  PERFORM pg_advisory_xact_lock(hashtext('fin_audit_' || NEW.environment));

  SELECT row_hash INTO tail
    FROM fin.financial_audit_events
   WHERE environment = NEW.environment
   ORDER BY created_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF tail IS NULL THEN
    NEW.prev_hash := repeat('0', 64);
  ELSE
    NEW.prev_hash := tail;
  END IF;

  NEW.row_hash := encode(
    digest(
      fin.json_canonical(
        fin.audit_payload_json(
          NEW.id, NEW.environment, NEW.actor_type, NEW.actor_id,
          NEW.actor_email_snapshot, NEW.action, NEW.target_type, NEW.target_id,
          NEW.before_state, NEW.after_state, NEW.reason_code,
          NEW.approval_request_id, NEW.request_id, NEW.created_at, NEW.prev_hash
        )
      ),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_financial_audit_chain
  BEFORE INSERT ON fin.financial_audit_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_financial_audit_chain();

CREATE OR REPLACE FUNCTION fin.audit_stored_hash_valid(e fin.financial_audit_events)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT e.row_hash = encode(
    digest(
      fin.json_canonical(
        fin.audit_payload_json(
          e.id, e.environment, e.actor_type, e.actor_id,
          e.actor_email_snapshot, e.action, e.target_type, e.target_id,
          e.before_state, e.after_state, e.reason_code,
          e.approval_request_id, e.request_id, e.created_at, e.prev_hash
        )
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- H §3.2 verifier. Walk from start_id back to genesis; break at first mismatch
-- or when a stored row_hash no longer matches JCS (superuser tamper).
CREATE OR REPLACE FUNCTION fin.verify_audit_chain(p_start_id UUID)
RETURNS TABLE (
  id UUID,
  environment TEXT,
  row_hash TEXT,
  prev_hash TEXT,
  created_at TIMESTAMPTZ,
  depth INTEGER,
  at_genesis BOOLEAN,
  broken BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE walk AS (
    SELECT e.id, e.environment, e.row_hash, e.prev_hash, e.created_at,
           1 AS depth,
           (e.prev_hash = repeat('0', 64)) AS at_genesis,
           (NOT fin.audit_stored_hash_valid(e)) AS broken
      FROM fin.financial_audit_events e
     WHERE e.id = p_start_id
    UNION ALL
    SELECT prev.id, prev.environment, prev.row_hash, prev.prev_hash, prev.created_at,
           walk.depth + 1,
           (prev.prev_hash = repeat('0', 64)),
           (walk.prev_hash <> prev.row_hash) OR walk.broken
             OR (NOT fin.audit_stored_hash_valid(prev))
      FROM walk
      JOIN fin.financial_audit_events prev
        ON prev.row_hash = walk.prev_hash
       AND prev.environment = walk.environment
     WHERE walk.at_genesis = false AND walk.broken = false
  )
  SELECT walk.id, walk.environment, walk.row_hash, walk.prev_hash, walk.created_at,
         walk.depth, walk.at_genesis, walk.broken
    FROM walk
   WHERE walk.broken OR walk.at_genesis
   ORDER BY walk.depth DESC;
$$;
