-- Stage 13d — fin_public.* read-redirection views (DL-210).
-- Do NOT overload commercial.* — application code still reads
-- commercial.usage_events until 13e/13f. These views exist so
-- read-heavy admin reports can start migrating.
-- security_invoker = true so FORCE RLS on the underlying fin.*
-- tables continues to apply as the calling role.

CREATE SCHEMA IF NOT EXISTS fin_public;
ALTER SCHEMA fin_public OWNER TO fin_migrator;
REVOKE ALL ON SCHEMA fin_public FROM PUBLIC;
GRANT USAGE ON SCHEMA fin_public TO fin_app_role, fin_recon_role,
  fin_finance_role, fin_auditor_role, fin_migrate_role, fin_migrator;

-- commercial.usage_events → fin.usage_events
CREATE OR REPLACE VIEW fin_public.usage_events
  WITH (security_invoker = true)
AS
SELECT * FROM fin.usage_events;

COMMENT ON VIEW fin_public.usage_events IS
  'Stage 13d read redirect (DL-210). SELECT * FROM fin.usage_events; FORCE RLS applies via security_invoker.';

ALTER VIEW fin_public.usage_events OWNER TO fin_migrator;

-- commercial.ledger_entries → fin.rated_usage (consumption mirror)
CREATE OR REPLACE VIEW fin_public.ledger_entries
  WITH (security_invoker = true)
AS
SELECT
  COALESCE(ru.source_row_id, ru.id::text) AS id,
  t.public_tenant_id AS tenant_id,
  ru.amount_minor::numeric AS amount,
  ru.source_system,
  ru.source_row_id,
  ru.currency,
  ru.occurred_at,
  ru.created_at,
  ru.environment,
  ru.tenant_id AS fin_tenant_id
FROM fin.rated_usage ru
LEFT JOIN fin.tenants t ON t.id = ru.tenant_id
WHERE ru.source_system IN ('commercial.ledger_entries', 'commercial');

COMMENT ON VIEW fin_public.ledger_entries IS
  'Stage 13d read redirect (DL-210). Consumption mirror from fin.rated_usage; FORCE RLS applies via security_invoker.';

ALTER VIEW fin_public.ledger_entries OWNER TO fin_migrator;

GRANT SELECT ON fin_public.usage_events, fin_public.ledger_entries
  TO fin_app_role, fin_finance_role, fin_auditor_role, fin_recon_role, fin_migrate_role;

-- DL-210: commercial-only tables (no fin.* mirror, no view). NOTICE for operators.
DO $$
DECLARE
  t RECORD;
  mirrored TEXT[] := ARRAY['usage_events', 'ledger_entries'];
BEGIN
  FOR t IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'commercial'
       AND tablename <> ALL (mirrored)
       AND tablename NOT LIKE 'usage_events\_%' ESCAPE '\'
     ORDER BY tablename
  LOOP
    RAISE NOTICE 'DL-210 commercial-only (no fin_public view): %', t.tablename;
  END LOOP;
END
$$;
