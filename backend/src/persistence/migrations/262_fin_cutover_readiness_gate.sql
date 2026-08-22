-- Stage 13d — fin.cutover_active_environment singleton (DL-207 / DL-209).
-- Seeded OFF per environment. Operator flips via POST /cutover/activate.
-- FIN_ONLY requires a referenced attestation signed within 7 days.

CREATE TABLE fin.cutover_active_environment (
  environment TEXT PRIMARY KEY CHECK (environment IN ('LIVE', 'TEST')),
  mode TEXT NOT NULL CHECK (mode IN ('OFF', 'DUAL', 'FIN_ONLY')),
  attestation_id UUID REFERENCES fin.cutover_parity_attestations(id),
  activated_at TIMESTAMPTZ NOT NULL,
  activated_by_email TEXT NOT NULL,
  activated_by_actor_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.cutover_active_environment IS
  'Stage 13d singleton cutover mode per environment (DL-207). Seeded OFF; FIN_ONLY requires a fresh attestation.';
COMMENT ON COLUMN fin.cutover_active_environment.mode IS
  'OFF/DUAL fall back to env-var + allowlist. FIN_ONLY short-circuits resolveCutoverMode.';

CREATE OR REPLACE FUNCTION fin.trg_cutover_active_environment_fin_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  signed TIMESTAMPTZ;
BEGIN
  IF NEW.mode = 'FIN_ONLY' THEN
    IF NEW.attestation_id IS NULL THEN
      RAISE EXCEPTION 'CUTOVER_ATTESTATION_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
    SELECT a.signed_at INTO signed
      FROM fin.cutover_parity_attestations a
     WHERE a.id = NEW.attestation_id;
    IF signed IS NULL THEN
      RAISE EXCEPTION 'CUTOVER_ATTESTATION_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
    IF signed < now() - interval '7 days' THEN
      RAISE EXCEPTION 'CUTOVER_ATTESTATION_STALE'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cutover_active_environment_fin_only
  BEFORE INSERT OR UPDATE ON fin.cutover_active_environment
  FOR EACH ROW EXECUTE FUNCTION fin.trg_cutover_active_environment_fin_only();

ALTER TABLE fin.cutover_active_environment OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_cutover_active_environment_fin_only() OWNER TO fin_migrator;

ALTER TABLE fin.cutover_active_environment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_active_environment FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_active_environment
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_cutover_active_app_read ON fin.cutover_active_environment
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_cutover_active_admin_write ON fin.cutover_active_environment
  FOR ALL TO fin_app_role
  USING (fin.platform_admin_bypass())
  WITH CHECK (fin.platform_admin_bypass());

CREATE POLICY fin_cutover_active_finance_read ON fin.cutover_active_environment
  FOR SELECT TO fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_cutover_active_recon_read ON fin.cutover_active_environment
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT ON fin.cutover_active_environment TO fin_app_role;
GRANT INSERT, UPDATE, DELETE ON fin.cutover_active_environment TO fin_app_role;
REVOKE TRUNCATE ON fin.cutover_active_environment FROM fin_app_role;

GRANT SELECT ON fin.cutover_active_environment
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

INSERT INTO fin.cutover_active_environment (
  environment, mode, attestation_id, activated_at,
  activated_by_email, activated_by_actor_type, updated_at
) VALUES
  ('LIVE', 'OFF', NULL, now(), 'migration@fin.local', 'SYSTEM', now()),
  ('TEST', 'OFF', NULL, now(), 'migration@fin.local', 'SYSTEM', now())
ON CONFLICT (environment) DO NOTHING;
