-- Stage 13d — freeze commercial.* writes (DL-206).
-- Discovers tables from pg_tables so a later commercial.* table is still
-- write-blocked. SELECT remains for auditors, migrator, and 13e/13f reads.
-- fin_migrator is never revoked. Idempotent: REVOKE of an already-revoked
-- privilege is a no-op. Paired down-migration is 260b (manual apply only).

DO $$
DECLARE
  t RECORD;
  r RECORD;
  role_name TEXT;
  roles TEXT[] := ARRAY[
    'fin_app_role',
    'fin_recon_role',
    'fin_finance_role',
    'fin_auditor_role',
    'fin_migrate_role'
  ];
BEGIN
  -- Any additional non-superuser, non-migrator role that currently writes
  -- commercial.* (legacy app roles that were GRANTed outside 109).
  FOR r IN
    SELECT DISTINCT g.grantee::text AS grantee
      FROM information_schema.role_table_grants g
      JOIN pg_roles pr ON pr.rolname = g.grantee
     WHERE g.table_schema = 'commercial'
       AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       AND pr.rolsuper = false
       AND g.grantee NOT IN ('fin_migrator', 'postgres', 'rds_superuser')
  LOOP
    IF NOT (r.grantee = ANY (roles)) THEN
      roles := array_append(roles, r.grantee);
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY roles
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      CONTINUE;
    END IF;
    FOR t IN
      SELECT tablename
        FROM pg_tables
       WHERE schemaname = 'commercial'
       ORDER BY tablename
    LOOP
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON commercial.%I FROM %I',
        t.tablename,
        role_name
      );
    END LOOP;
  END LOOP;
END
$$;
