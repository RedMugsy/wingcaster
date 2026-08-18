-- Stage 1 — roles, FORCE RLS, grants, detective REVOKE on public.audit_log (H §0–§2).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_migrator') THEN
    CREATE ROLE fin_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_app_role') THEN
    CREATE ROLE fin_app_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_recon_role') THEN
    CREATE ROLE fin_recon_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_finance_role') THEN
    CREATE ROLE fin_finance_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_auditor_role') THEN
    CREATE ROLE fin_auditor_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fin_migrate_role') THEN
    CREATE ROLE fin_migrate_role NOLOGIN;
  END IF;
END
$$;

GRANT fin_app_role TO CURRENT_USER;
GRANT fin_recon_role TO CURRENT_USER;
GRANT fin_finance_role TO CURRENT_USER;
GRANT fin_auditor_role TO CURRENT_USER;
GRANT fin_migrate_role TO CURRENT_USER;
GRANT fin_migrator TO CURRENT_USER;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'fin'
  LOOP
    EXECUTE format('ALTER TABLE fin.%I OWNER TO fin_migrator', r.tablename);
  END LOOP;
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'fin'
  LOOP
    EXECUTE format('ALTER FUNCTION fin.%I(%s) OWNER TO fin_migrator', r.proname, r.args);
  END LOOP;
END
$$;

ALTER SCHEMA fin OWNER TO fin_migrator;

REVOKE ALL ON SCHEMA fin FROM PUBLIC;
GRANT USAGE ON SCHEMA fin TO fin_app_role, fin_recon_role, fin_finance_role,
  fin_auditor_role, fin_migrate_role, fin_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM PUBLIC;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'fin'
  LOOP
    EXECUTE format('ALTER TABLE fin.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('ALTER TABLE fin.%I FORCE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format(
      'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
      r.tablename
    );
  END LOOP;
END
$$;

-- Predicate helper: book belongs to the GUC tenant (or elevated platform admin).
CREATE OR REPLACE FUNCTION fin.book_visible(p_book_id UUID, p_environment TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
  SELECT
    p_environment IS NOT NULL
    AND p_environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.ledger_books b
      WHERE b.id = p_book_id
        AND b.environment = p_environment
        AND (
          b.tenant_id::text = current_setting('fin.tenant_id', true)
          OR fin.platform_admin_bypass()
        )
    );
$$;

ALTER FUNCTION fin.book_visible(UUID, TEXT) OWNER TO fin_migrator;

-- ---------------------------------------------------------------------------
-- Tenant-scoped tables
-- ---------------------------------------------------------------------------
CREATE POLICY fin_tenant_isolation ON fin.tenants
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.holders
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.billing_accounts
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.cost_centres
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.organisational_nodes
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.funding_relationships
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.ledger_books
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.lots
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.holds
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.usage_limits
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_tenant_isolation ON fin.idempotency_keys
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  );

CREATE POLICY fin_tenant_isolation ON fin.approval_requests
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  );

CREATE POLICY fin_tenant_isolation ON fin.usage_events_dlq
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  );

-- ---------------------------------------------------------------------------
-- Ledger children without tenant_id
-- ---------------------------------------------------------------------------
CREATE POLICY fin_book_via_tenant ON fin.ledger_accounts
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (fin.book_visible(book_id, environment))
  WITH CHECK (fin.book_visible(book_id, environment));

CREATE POLICY fin_book_via_tenant ON fin.ledger_transactions
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (fin.book_visible(book_id, environment))
  WITH CHECK (fin.book_visible(book_id, environment));

CREATE POLICY fin_book_via_tenant ON fin.ledger_postings
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (fin.book_visible(book_id, environment))
  WITH CHECK (fin.book_visible(book_id, environment));

CREATE POLICY fin_book_via_tenant ON fin.account_balances
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.ledger_accounts a
      WHERE a.id = account_balances.account_id
        AND fin.book_visible(a.book_id, a.environment)
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.ledger_accounts a
      WHERE a.id = account_balances.account_id
        AND fin.book_visible(a.book_id, a.environment)
    )
  );

CREATE POLICY fin_book_via_tenant ON fin.lot_allocations
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.lots l
      WHERE l.id = lot_allocations.lot_id
        AND l.environment = lot_allocations.environment
        AND (l.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.lots l
      WHERE l.id = lot_allocations.lot_id
        AND l.environment = lot_allocations.environment
        AND (l.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

CREATE POLICY fin_book_via_tenant ON fin.lot_applicability_rules
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.lots l
      WHERE l.id = lot_applicability_rules.lot_id
        AND (l.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.lots l
      WHERE l.id = lot_applicability_rules.lot_id
        AND (l.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

CREATE POLICY fin_book_via_tenant ON fin.limit_counters
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.usage_limits u
      WHERE u.id = limit_counters.usage_limit_id
        AND (u.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.usage_limits u
      WHERE u.id = limit_counters.usage_limit_id
        AND (u.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

-- account_controls: subject walks back to the GUC tenant.
CREATE POLICY fin_account_controls_scope ON fin.account_controls
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_recon_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      fin.platform_admin_bypass()
      OR (subject_type = 'TENANT' AND subject_id::text = current_setting('fin.tenant_id', true))
      OR (
        subject_type = 'HOLDER' AND EXISTS (
          SELECT 1 FROM fin.holders h
          WHERE h.id = account_controls.subject_id
            AND h.tenant_id::text = current_setting('fin.tenant_id', true)
        )
      )
      OR (
        subject_type = 'BILLING_ACCOUNT' AND EXISTS (
          SELECT 1 FROM fin.billing_accounts ba
          WHERE ba.id = account_controls.subject_id
            AND ba.tenant_id::text = current_setting('fin.tenant_id', true)
        )
      )
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      fin.platform_admin_bypass()
      OR (subject_type = 'TENANT' AND subject_id::text = current_setting('fin.tenant_id', true))
      OR (
        subject_type = 'HOLDER' AND EXISTS (
          SELECT 1 FROM fin.holders h
          WHERE h.id = account_controls.subject_id
            AND h.tenant_id::text = current_setting('fin.tenant_id', true)
        )
      )
      OR (
        subject_type = 'BILLING_ACCOUNT' AND EXISTS (
          SELECT 1 FROM fin.billing_accounts ba
          WHERE ba.id = account_controls.subject_id
            AND ba.tenant_id::text = current_setting('fin.tenant_id', true)
        )
      )
    )
  );

CREATE POLICY fin_holder_via_tenant ON fin.authorization_attempts
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      fin.platform_admin_bypass()
      OR holder_id IS NULL
      OR EXISTS (
        SELECT 1 FROM fin.holders h
        WHERE h.id = authorization_attempts.holder_id
          AND h.tenant_id::text = current_setting('fin.tenant_id', true)
      )
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      fin.platform_admin_bypass()
      OR holder_id IS NULL
      OR EXISTS (
        SELECT 1 FROM fin.holders h
        WHERE h.id = authorization_attempts.holder_id
          AND h.tenant_id::text = current_setting('fin.tenant_id', true)
      )
    )
  );

CREATE POLICY fin_approval_actions_via_request ON fin.approval_actions
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    EXISTS (
      SELECT 1 FROM fin.approval_requests r
      WHERE r.id = approval_actions.request_id
        AND r.environment = current_setting('fin.environment', true)
        AND (
          r.tenant_id::text = current_setting('fin.tenant_id', true)
          OR fin.platform_admin_bypass()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fin.approval_requests r
      WHERE r.id = approval_actions.request_id
        AND r.environment = current_setting('fin.environment', true)
        AND (
          r.tenant_id::text = current_setting('fin.tenant_id', true)
          OR fin.platform_admin_bypass()
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Catalog / platform / FX (no tenant grain)
-- ---------------------------------------------------------------------------
CREATE POLICY fin_catalog_app ON fin.platforms
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.platforms
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_catalog_app ON fin.environments
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.environments
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_catalog_app ON fin.platform_legal_entities
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.platform_legal_entities
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_fx_insert ON fin.fx_rate_snapshots
  FOR INSERT TO fin_app_role WITH CHECK (true);
CREATE POLICY fin_fx_select ON fin.fx_rate_snapshots
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role, fin_recon_role
  USING (true);

CREATE POLICY fin_outbox_env ON fin.outbox_events
  FOR ALL TO fin_app_role
  USING (environment = current_setting('fin.environment', true))
  WITH CHECK (environment = current_setting('fin.environment', true));

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
CREATE POLICY fin_audit_insert ON fin.financial_audit_events
  FOR INSERT TO fin_app_role, fin_recon_role, fin_migrate_role
  WITH CHECK (environment = current_setting('fin.environment', true));

CREATE POLICY fin_audit_select ON fin.financial_audit_events
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role, fin_recon_role, fin_migrate_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      fin.platform_admin_bypass()
      OR current_user IN ('fin_auditor_role', 'fin_recon_role', 'fin_migrate_role')
      OR (
        target_type = 'TENANT'
        AND target_id::text = current_setting('fin.tenant_id', true)
      )
      OR EXISTS (
        SELECT 1 FROM fin.holders h
        WHERE h.id = financial_audit_events.target_id
          AND h.tenant_id::text = current_setting('fin.tenant_id', true)
      )
      OR EXISTS (
        SELECT 1 FROM fin.lots l
        WHERE l.id = financial_audit_events.target_id
          AND l.tenant_id::text = current_setting('fin.tenant_id', true)
      )
      OR EXISTS (
        SELECT 1 FROM fin.ledger_books b
        WHERE b.id = financial_audit_events.target_id
          AND b.tenant_id::text = current_setting('fin.tenant_id', true)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
CREATE POLICY fin_recon_all_read ON fin.reconciliation_runs
  FOR SELECT TO fin_recon_role, fin_app_role, fin_finance_role, fin_auditor_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_write ON fin.reconciliation_runs
  FOR ALL TO fin_recon_role
  USING (environment = current_setting('fin.environment', true))
  WITH CHECK (environment = current_setting('fin.environment', true));

CREATE POLICY fin_recon_all_read ON fin.reconciliation_checks
  FOR SELECT TO fin_recon_role, fin_app_role, fin_finance_role, fin_auditor_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_write ON fin.reconciliation_checks
  FOR INSERT TO fin_recon_role
  WITH CHECK (environment = current_setting('fin.environment', true));

CREATE POLICY fin_recon_all_read ON fin.reconciliation_drift
  FOR SELECT TO fin_recon_role, fin_app_role, fin_finance_role, fin_auditor_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_write ON fin.reconciliation_drift
  FOR INSERT TO fin_recon_role
  WITH CHECK (environment = current_setting('fin.environment', true));

CREATE POLICY fin_recon_all_read ON fin.reconciliation_resolution
  FOR SELECT TO fin_recon_role, fin_app_role, fin_finance_role, fin_auditor_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_write ON fin.reconciliation_resolution
  FOR ALL TO fin_recon_role
  USING (environment = current_setting('fin.environment', true))
  WITH CHECK (environment = current_setting('fin.environment', true));

-- Recon SELECT on economic tables (environment only; no tenant GUC required).
CREATE POLICY fin_recon_all_read ON fin.tenants
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.holders
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.billing_accounts
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.ledger_books
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.ledger_accounts
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.ledger_transactions
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.ledger_postings
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.account_balances
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.lots
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.holds
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

-- ---------------------------------------------------------------------------
-- Grants by mutability (H §2)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
  fin.platforms, fin.environments, fin.platform_legal_entities,
  fin.tenants, fin.holders, fin.billing_accounts, fin.cost_centres,
  fin.organisational_nodes, fin.funding_relationships, fin.account_controls,
  fin.ledger_books, fin.ledger_accounts,
  fin.lots, fin.lot_applicability_rules, fin.holds, fin.usage_limits,
  fin.approval_requests, fin.idempotency_keys, fin.outbox_events,
  fin.usage_events_dlq, fin.reconciliation_runs, fin.reconciliation_resolution
  TO fin_app_role;

GRANT SELECT, INSERT ON
  fin.ledger_transactions, fin.ledger_postings, fin.lot_allocations,
  fin.fx_rate_snapshots, fin.authorization_attempts, fin.approval_actions,
  fin.financial_audit_events
  TO fin_app_role;

GRANT SELECT ON fin.account_balances, fin.limit_counters TO fin_app_role;

REVOKE UPDATE, DELETE, TRUNCATE ON
  fin.ledger_transactions, fin.ledger_postings, fin.lot_allocations,
  fin.fx_rate_snapshots, fin.authorization_attempts, fin.approval_actions,
  fin.financial_audit_events, fin.reconciliation_checks, fin.reconciliation_drift
  FROM fin_app_role;

REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA fin FROM fin_app_role;

GRANT SELECT ON ALL TABLES IN SCHEMA fin TO fin_recon_role;
GRANT INSERT, SELECT ON
  fin.reconciliation_runs, fin.reconciliation_checks, fin.reconciliation_drift,
  fin.financial_audit_events
  TO fin_recon_role;
GRANT SELECT, INSERT, UPDATE ON
  fin.reconciliation_resolution, fin.reconciliation_runs, fin.account_controls
  TO fin_recon_role;
REVOKE UPDATE, DELETE ON fin.ledger_postings, fin.lots FROM fin_recon_role;
REVOKE INSERT ON fin.ledger_postings, fin.ledger_transactions, fin.lots FROM fin_recon_role;

GRANT SELECT ON ALL TABLES IN SCHEMA fin TO fin_finance_role, fin_auditor_role;
REVOKE INSERT, UPDATE, DELETE ON
  fin.ledger_postings, fin.ledger_transactions, fin.financial_audit_events
  FROM fin_finance_role, fin_auditor_role;

GRANT INSERT, SELECT ON fin.financial_audit_events TO fin_migrate_role;
GRANT SELECT ON ALL TABLES IN SCHEMA fin TO fin_migrate_role;

REVOKE UPDATE, DELETE, TRUNCATE ON fin.financial_audit_events
  FROM fin_app_role, fin_recon_role, fin_migrate_role, fin_finance_role, fin_auditor_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fin TO
  fin_app_role, fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

-- Detective control on the live mutable audit table (E-3). Do not rewrite 009.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM fin_app_role;
GRANT SELECT, INSERT ON public.audit_log TO fin_app_role;
