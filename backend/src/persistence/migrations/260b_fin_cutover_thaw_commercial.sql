-- Stage 13d ROLLBACK — thaw commercial.* writes (DL-206 / DL-211).
-- MANUAL APPLY ONLY. The auto-migration runner skips `NNN[letter]_*.sql`
-- filenames so this file never runs in the normal loop.
-- Re-GRANTs INSERT, UPDATE, DELETE to the same roles 260 revoked.
-- Does NOT re-GRANT TRUNCATE.

DO $$
DECLARE
  t RECORD;
  role_name TEXT;
  roles TEXT[] := ARRAY[
    'fin_app_role',
    'fin_recon_role',
    'fin_finance_role',
    'fin_auditor_role',
    'fin_migrate_role'
  ];
BEGIN
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
        'GRANT INSERT, UPDATE, DELETE ON commercial.%I TO %I',
        t.tablename,
        role_name
      );
    END LOOP;
  END LOOP;
END
$$;
