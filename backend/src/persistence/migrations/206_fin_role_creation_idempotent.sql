-- Stage 10 follow-up — idempotent role provisioning.
-- Original CREATE ROLE statements in Stage 1 migration 109
-- race on pg_authid when parallel per-test-DB creations run against
-- the shared cluster (IF NOT EXISTS then CREATE is still TOCTOU).
-- This additive migration ensures re-runs are no-ops (matches Stage 1
-- frozen files' behavior on fresh clusters because the DO block
-- short-circuits when the role exists).
-- DL-147. The test harness also retries 23505 on pg_authid (postgres.js).

DO $$
DECLARE
  role_name TEXT;
  role_names TEXT[] := ARRAY[
    'fin_migrator', 'fin_app_role', 'fin_recon_role',
    'fin_finance_role', 'fin_auditor_role', 'fin_migrate_role'
  ];
BEGIN
  FOREACH role_name IN ARRAY role_names LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END
$$;
