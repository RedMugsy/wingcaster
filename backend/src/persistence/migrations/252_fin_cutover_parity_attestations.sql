-- Stage 13c — fin.cutover_parity_attestations (DL-198 / DL-199).
-- APPEND_ONLY Finance sign-off over a 30-day GREEN burn-in evidence set.
-- UNIQUE (environment, attestation_hash) makes re-sign against the same
-- evidence a dedupe.

CREATE TABLE fin.cutover_parity_attestations (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  burn_in_days INT NOT NULL CHECK (burn_in_days > 0),
  first_green_at TIMESTAMPTZ,
  last_green_at TIMESTAMPTZ,
  reports_included_from UUID REFERENCES fin.cutover_parity_reports(id),
  reports_included_to UUID REFERENCES fin.cutover_parity_reports(id),
  total_rows_checked BIGINT NOT NULL DEFAULT 0,
  total_rows_drifted BIGINT NOT NULL DEFAULT 0,
  outstanding_corrections BIGINT NOT NULL DEFAULT 0,
  attestation_hash TEXT NOT NULL,
  signed_by_actor_type TEXT,
  signed_by_actor_id TEXT,
  signed_by_email TEXT,
  signed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.cutover_parity_attestations IS
  'APPEND_ONLY Stage 13c Finance attestation (DL-198). Hash is SHA-256 JCS over the evidence set; signer email is WHO attested.';
COMMENT ON COLUMN fin.cutover_parity_attestations.attestation_hash IS
  'SHA-256 hex of canonical JCS over {environment, first_green_at, last_green_at, reports, total_rows_checked, total_rows_drifted, outstanding_corrections}.';

CREATE UNIQUE INDEX uq_cutover_parity_attestations_hash
  ON fin.cutover_parity_attestations (environment, attestation_hash);

CREATE INDEX idx_cutover_parity_attestations_signed
  ON fin.cutover_parity_attestations (environment, signed_at DESC);

CREATE TRIGGER trg_cutover_parity_attestations_append_only
  BEFORE UPDATE OR DELETE ON fin.cutover_parity_attestations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_cutover_parity_append_only();

ALTER TABLE fin.cutover_parity_attestations OWNER TO fin_migrator;

ALTER TABLE fin.cutover_parity_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_parity_attestations FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_parity_attestations
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_parity_attestations_insert ON fin.cutover_parity_attestations
  FOR INSERT TO fin_app_role
  WITH CHECK (fin.platform_admin_bypass());

CREATE POLICY fin_parity_attestations_admin_read ON fin.cutover_parity_attestations
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_parity_attestations_app_read ON fin.cutover_parity_attestations
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_parity_attestations_recon_read ON fin.cutover_parity_attestations
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.cutover_parity_attestations TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_parity_attestations FROM fin_app_role;

GRANT SELECT ON fin.cutover_parity_attestations
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
