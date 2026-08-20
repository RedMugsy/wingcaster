/**
 * Exact F_RECONCILIATION.md §6 query pairs. Do not paraphrase.
 */
export const CHECKS = [
  {
    check_code: 'R001',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'ledger_transactions',
    source_query: 'SELECT t.id AS entity_id, 0::bigint AS qty FROM fin.ledger_transactions t',
    comparison_query: 'SELECT p.transaction_id AS entity_id, SUM(p.amount_units)::bigint AS qty FROM fin.ledger_postings p GROUP BY p.transaction_id',
    emptyComparisonIsDrift: true,
  },
  {
    check_code: 'R002',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_postings',
    source_query: 'SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p',
    comparison_query: 'SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE p.book_id = t.book_id AND a.book_id = p.book_id',
  },
  {
    check_code: 'R003',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_books',
    source_query: 'SELECT b.id AS entity_id, 0::bigint AS qty FROM fin.ledger_books b',
    comparison_query: 'SELECT a.book_id AS entity_id, SUM(ab.balance_units)::bigint AS qty FROM fin.ledger_accounts a JOIN fin.account_balances ab ON ab.account_id = a.id GROUP BY a.book_id',
  },
  {
    check_code: 'R004',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'account_balances',
    source_query: 'SELECT ab.account_id AS entity_id, ab.balance_units AS qty FROM fin.account_balances ab',
    comparison_query: 'SELECT p.account_id AS entity_id, SUM(p.amount_units)::bigint AS qty FROM fin.ledger_postings p GROUP BY p.account_id',
    missingSourceIsCacheMissing: true,
  },
  {
    check_code: 'R005',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'account_balances',
    source_query: 'SELECT ab.account_id AS entity_id, 1::bigint AS qty FROM fin.account_balances ab',
    comparison_query: 'SELECT ab.account_id AS entity_id, 1::bigint AS qty FROM fin.account_balances ab JOIN fin.ledger_postings p ON p.id = ab.last_posting_id AND p.account_id = ab.account_id WHERE p.created_at = (SELECT MAX(p2.created_at) FROM fin.ledger_postings p2 WHERE p2.account_id = ab.account_id)',
  },
  {
    check_code: 'R006',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'lots',
    source_query: 'SELECT l.id AS entity_id, l.remaining_units AS qty FROM fin.lots l',
    comparison_query: 'SELECT l.id AS entity_id, (l.granted_units + COALESCE((SELECT SUM(a.units) FROM fin.lot_allocations a WHERE a.lot_id = l.id), 0))::bigint AS qty FROM fin.lots l',
  },
  {
    check_code: 'R007',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'lots',
    source_query: 'SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l',
    comparison_query: 'SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l WHERE l.remaining_units >= 0 AND l.remaining_units <= l.granted_units',
  },
  {
    check_code: 'R008',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'lot_allocations',
    source_query: 'SELECT a.id AS entity_id, 1::bigint AS qty FROM fin.lot_allocations a',
    comparison_query: 'SELECT a.id AS entity_id, 1::bigint AS qty FROM fin.lot_allocations a JOIN fin.ledger_postings p ON p.id = a.posting_id JOIN fin.lots l ON l.id = a.lot_id WHERE p.lot_id = a.lot_id AND p.book_id = l.book_id',
  },
  {
    check_code: 'R009',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_postings',
    source_query: "SELECT p.id AS entity_id, p.amount_units AS qty FROM fin.ledger_postings p JOIN fin.ledger_accounts a ON a.id = p.account_id JOIN fin.ledger_transactions t ON t.id = p.transaction_id WHERE p.lot_id IS NOT NULL AND a.account_type <> 'ISSUANCE' AND t.shape NOT IN ('FUNDING', 'GRANT')",
    comparison_query: 'SELECT a.posting_id AS entity_id, a.units AS qty FROM fin.lot_allocations a',
  },
  {
    check_code: 'R010',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'holds',
    source_query: "SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status = 'OPEN'",
    comparison_query: "SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status = 'OPEN' AND h.authorize_tx_id IS NOT NULL",
  },
  {
    check_code: 'R011',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'holds',
    source_query: "SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status IN ('CAPTURED','VOIDED','EXPIRED')",
    comparison_query: "SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE (h.status = 'CAPTURED' AND h.capture_tx_id IS NOT NULL) OR (h.status IN ('VOIDED','EXPIRED') AND h.release_tx_id IS NOT NULL)",
  },
  {
    check_code: 'R012',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'holds',
    source_query: 'SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.authorize_tx_id IS NOT NULL',
    comparison_query: "SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h JOIN fin.ledger_transactions t ON t.id = h.authorize_tx_id AND t.shape = 'HOLD' AND t.economic_source_type = 'HOLD' AND t.economic_source_id = h.id",
  },
  {
    check_code: 'R013',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_transactions',
    source_query: 'SELECT t.pair_id AS entity_id, 2::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL GROUP BY t.pair_id',
    comparison_query: 'SELECT t.pair_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL GROUP BY t.pair_id',
  },
  {
    check_code: 'R014',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_transactions',
    source_query: 'SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL',
    comparison_query: "SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL AND t.shape = 'TRANSFER'",
  },
  {
    check_code: 'R015',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_BOOK',
    entity_type: 'ledger_transactions',
    source_query: 'SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL',
    comparison_query: 'SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t JOIN fin.ledger_books b ON b.id = t.book_id JOIN fin.ledger_transactions t2 ON t2.pair_id = t.pair_id AND t2.id <> t.id JOIN fin.ledger_books b2 ON b2.id = t2.book_id WHERE t.fx_rate_snapshot_id IS NOT NULL OR b.currency = b2.currency',
  },
  {
    check_code: 'R016',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'ledger_postings',
    source_query: 'SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p',
    comparison_query: 'SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_books b ON b.id = p.book_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE p.environment = t.environment AND p.environment = b.environment AND p.environment = a.environment',
  },
  {
    check_code: 'R017',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'lots',
    source_query: 'SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l',
    comparison_query: 'SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l JOIN fin.ledger_books b ON b.id = l.book_id WHERE l.environment = b.environment AND l.tenant_id = b.tenant_id',
  },
  {
    check_code: 'R018',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'ledger_books',
    source_query: 'SELECT b.id AS entity_id, 7::bigint AS qty FROM fin.ledger_books b',
    comparison_query: 'SELECT a.book_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.ledger_accounts a GROUP BY a.book_id',
  },
  {
    check_code: 'R019',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'ledger_postings',
    source_query: "SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE a.account_type = 'ADJUSTMENT' AND p.fx_rate_snapshot_id IS NOT NULL",
    comparison_query: "SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE a.account_type = 'ADJUSTMENT' AND t.reason_code = 'FX_ROUNDING'",
  },
  {
    check_code: 'R020',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'holds',
    source_query: "SELECT h.id AS entity_id, h.units AS qty FROM fin.holds h WHERE h.status = 'OPEN'",
    comparison_query: "SELECT h.id AS entity_id, SUM(p.amount_units) FILTER (WHERE a.account_type = 'HELD')::bigint AS qty FROM fin.holds h JOIN fin.ledger_postings p ON p.transaction_id = h.authorize_tx_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE h.status = 'OPEN' GROUP BY h.id",
  },
  {
    check_code: 'R021',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'holds',
    source_query: "SELECT h.id AS entity_id, h.units AS qty FROM fin.holds h WHERE h.status = 'CAPTURED'",
    comparison_query: "SELECT h.id AS entity_id, ABS(SUM(p.amount_units) FILTER (WHERE a.account_type = 'CONSUMED'))::bigint AS qty FROM fin.holds h JOIN fin.ledger_postings p ON p.transaction_id = h.capture_tx_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE h.status = 'CAPTURED' GROUP BY h.id",
  },
  {
    check_code: 'R022',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'limit_counters',
    source_query: 'SELECT c.id AS entity_id, c.consumed_units AS qty FROM fin.limit_counters c',
    comparison_query: `SELECT c.id AS entity_id, COALESCE(SUM(h.units),0)::bigint AS qty FROM fin.limit_counters c JOIN fin.usage_limits ul ON ul.id = c.usage_limit_id JOIN fin.holds h ON h.billing_account_id IN (SELECT ba.id FROM fin.billing_accounts ba JOIN fin.contract_components cc ON cc.id = ul.contract_component_id /* holder walk owned by Stage 6 */) AND h.status IN ('OPEN','CAPTURED') AND h.created_at IS NOT NULL GROUP BY c.id`,
  },
  {
    check_code: 'R023',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'facility_reservations',
    source_query: `SELECT r.id AS entity_id, 1::bigint AS qty
         FROM fin.facility_reservations r
         JOIN fin.credit_facilities f ON f.id = r.facility_id
        WHERE r.status = 'OPEN'
          AND f.status NOT IN ('ACTIVE', 'PAUSED')`,
    comparison_query: `SELECT r.id AS entity_id, 1::bigint AS qty
         FROM fin.facility_reservations r
         JOIN fin.credit_facilities f ON f.id = r.facility_id
        WHERE r.status = 'OPEN'
          AND f.status NOT IN ('ACTIVE', 'PAUSED')
          AND false`,
  },
  {
    check_code: 'R030',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'usage_events',
    source_query: 'SELECT MIN(u.id::text)::uuid AS entity_id, 1::bigint AS qty FROM fin.usage_events u GROUP BY u.environment, u.source_system, u.source_event_id, u.residency_key',
    comparison_query: 'SELECT MIN(u.id::text)::uuid AS entity_id, COUNT(*)::bigint AS qty FROM fin.usage_events u GROUP BY u.environment, u.source_system, u.source_event_id, u.residency_key',
  },
  {
    check_code: 'R031',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'usage_events',
    source_query: "SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL'",
    comparison_query: "SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u JOIN fin.usage_events o ON o.id = u.corrects_event_id AND o.residency_key = u.corrects_residency_key WHERE u.event_kind <> 'ORIGINAL'",
  },
  {
    check_code: 'R032',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'usage_events',
    source_query: 'SELECT 1 AS entity_id, 0::bigint AS qty',
    comparison_query: "SELECT 1 AS entity_id, COUNT(*)::bigint AS qty FROM information_schema.columns WHERE table_schema = 'fin' AND table_name = 'usage_events' AND column_name IN ('price_minor','casts_charged','rate_card_version')",
  },
  {
    check_code: 'R033',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'usage_events_dlq',
    source_query: 'SELECT d.id AS entity_id, 1::bigint AS qty FROM fin.usage_events_dlq d WHERE d.dead_lettered_at IS NULL AND d.next_retry_at < :now',
    comparison_query: 'SELECT d.id AS entity_id, 0::bigint AS qty FROM fin.usage_events_dlq d WHERE d.dead_lettered_at IS NULL AND d.next_retry_at < :now',
  },
  {
    check_code: 'R034',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'metered_usage_sources',
    source_query: 'SELECT s.usage_event_id AS entity_id, s.contribution_units AS qty FROM fin.metered_usage_sources s',
    comparison_query: 'SELECT s.usage_event_id AS entity_id, s.contribution_units AS qty FROM fin.metered_usage_sources s JOIN fin.usage_events u ON u.id = s.usage_event_id AND u.residency_key = s.residency_key',
  },
  {
    check_code: 'R035',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'metered_usage',
    source_query: "SELECT m.id AS entity_id, m.quantity_units AS qty FROM fin.metered_usage m WHERE m.status = 'ACTIVE'",
    comparison_query: "SELECT s.metered_usage_id AS entity_id, SUM(s.contribution_units)::bigint AS qty FROM fin.metered_usage_sources s JOIN fin.metered_usage m ON m.id = s.metered_usage_id WHERE m.status = 'ACTIVE' GROUP BY s.metered_usage_id",
  },
  {
    check_code: 'R036',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'metered_usage',
    source_query: "SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m WHERE m.status = 'SUPERSEDED'",
    comparison_query: "SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.metered_usage n ON n.supersedes_id = m.id WHERE m.status = 'SUPERSEDED'",
  },
  {
    check_code: 'R037',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'meter_versions',
    source_query: 'SELECT v.id AS entity_id, 0::bigint AS qty FROM fin.meter_versions v',
    comparison_query: "SELECT v.id AS entity_id, COUNT(v2.id)::bigint AS qty FROM fin.meter_versions v JOIN fin.meter_versions v2 ON v2.meter_id = v.meter_id AND v2.id <> v.id AND tstzrange(v.effective_from, COALESCE(v.effective_to, 'infinity'::timestamptz)) && tstzrange(v2.effective_from, COALESCE(v2.effective_to, 'infinity'::timestamptz)) GROUP BY v.id",
  },
  {
    check_code: 'R038',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'usage_events',
    source_query: 'SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u',
    comparison_query: "SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.residency_key = '__platform__' OR EXISTS (SELECT 1 FROM fin.platform_legal_entities le WHERE le.residency_key = u.residency_key)",
  },
  {
    check_code: 'R039',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'usage_events',
    source_query: "SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL'",
    comparison_query: "SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL' AND u.residency_key = u.corrects_residency_key",
  },
  {
    check_code: 'R040',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'rated_usage',
    source_query: 'SELECT r.id AS entity_id, r.amount_minor AS qty FROM fin.rated_usage r',
    comparison_query: "SELECT r.id AS entity_id, (r.explanation->>'amount_minor')::bigint AS qty FROM fin.rated_usage r WHERE r.rating_hash = encode(sha256(convert_to(fin.canonical_json(r.explanation), 'UTF8')), 'hex')",
  },
  {
    check_code: 'R041',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'rated_usage',
    source_query: 'SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r WHERE r.adjustment_of_id IS NOT NULL',
    comparison_query: 'SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.rated_usage o ON o.id = r.adjustment_of_id WHERE r.adjustment_of_id IS NOT NULL',
  },
  {
    check_code: 'R042',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'rated_usage',
    source_query: 'SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r',
    comparison_query: "SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r LEFT JOIN fin.billing_periods bp ON bp.id = r.billing_period_id LEFT JOIN fin.accounting_periods ap ON ap.id = r.accounting_period_id WHERE (r.late_class = 'OPEN_PERIOD' AND (bp.status IS NULL OR bp.status IN ('OPEN','USAGE_CLOSING'))) OR (r.late_class = 'PRE_INVOICE' AND bp.status IN ('USAGE_CLOSED','RATING_CLOSED','INVOICE_DRAFTED')) OR (r.late_class = 'POST_INVOICE' AND bp.status IN ('INVOICED','FINAL')) OR (r.late_class = 'CLOSED_ACCOUNTING' AND ap.status IN ('SOFT_CLOSED','HARD_CLOSED'))",
  },
  {
    check_code: 'R043',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'rated_usage',
    source_query: "SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r WHERE r.late_class = 'CLOSED_ACCOUNTING'",
    comparison_query: "SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.accounting_periods ap ON ap.id = r.accounting_period_id WHERE r.late_class = 'CLOSED_ACCOUNTING' AND ap.status IN ('OPEN','SOFT_CLOSED')",
  },
  {
    check_code: 'R044',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'invoice_lines',
    source_query: "SELECT il.id AS entity_id, il.amount_minor AS qty FROM fin.invoice_lines il WHERE il.source_type = 'RATED_USAGE'",
    comparison_query: "SELECT il.id AS entity_id, r.amount_minor AS qty FROM fin.invoice_lines il JOIN fin.rated_usage r ON r.id = il.source_id WHERE il.source_type = 'RATED_USAGE'",
  },
  {
    check_code: 'R045',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'rated_usage',
    source_query: 'SELECT r.id AS entity_id, r.billable_units AS qty FROM fin.rated_usage r',
    comparison_query: 'SELECT r.id AS entity_id, GREATEST(r.measured_units - r.included_units, 0)::bigint AS qty FROM fin.rated_usage r',
  },
  {
    check_code: 'R046',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'rated_usage',
    source_query: 'SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r',
    comparison_query: 'SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.contract_versions cv ON cv.id = r.contract_version_id JOIN fin.contracts c ON c.id = cv.contract_id WHERE r.currency = c.billing_currency',
  },
  {
    check_code: 'R047',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'price_versions',
    source_query: "SELECT v.id AS entity_id, 0::bigint AS qty FROM fin.price_versions v WHERE v.status IN ('ACTIVE','SUPERSEDED')",
    comparison_query: "SELECT v.id AS entity_id, COUNT(v2.id)::bigint AS qty FROM fin.price_versions v JOIN fin.price_versions v2 ON v2.price_id = v.price_id AND v2.id <> v.id AND v.status IN ('ACTIVE','SUPERSEDED') AND v2.status IN ('ACTIVE','SUPERSEDED') AND tstzrange(v.effective_from, COALESCE(v.effective_to, 'infinity'::timestamptz)) && tstzrange(v2.effective_from, COALESCE(v2.effective_to, 'infinity'::timestamptz)) GROUP BY v.id",
  },
  {
    check_code: 'R048',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'contract_versions',
    source_query: "SELECT v.id AS entity_id, 0::bigint AS qty FROM fin.contract_versions v WHERE v.status IN ('ACTIVE','SUPERSEDED')",
    comparison_query: "SELECT v.id AS entity_id, COUNT(v2.id)::bigint AS qty FROM fin.contract_versions v JOIN fin.contract_versions v2 ON v2.contract_id = v.contract_id AND v2.id <> v.id AND v.status IN ('ACTIVE','SUPERSEDED') AND v2.status IN ('ACTIVE','SUPERSEDED') AND tstzrange(v.effective_from, COALESCE(v.effective_to, 'infinity'::timestamptz)) && tstzrange(v2.effective_from, COALESCE(v2.effective_to, 'infinity'::timestamptz)) GROUP BY v.id",
  },
  {
    check_code: 'R049',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'metered_usage',
    source_query: "SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.rated_usage r_probe ON r_probe.metered_usage_id = m.id JOIN fin.billing_periods bp ON bp.id = r_probe.billing_period_id WHERE m.status = 'ACTIVE' AND bp.status IN ('RATING_CLOSED','INVOICE_DRAFTED','INVOICED','FINAL')",
    comparison_query: "SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.rated_usage r ON r.metered_usage_id = m.id WHERE m.status = 'ACTIVE'",
  },
  {
    check_code: 'R050',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'credit_facilities',
    comparisonMode: 'source_gte',
    source_query: `SELECT f.id AS entity_id, f.limit_minor AS qty
         FROM fin.credit_facilities f
        WHERE f.status IN ('ACTIVE', 'PAUSED')`,
    comparison_query: `SELECT r.facility_id AS entity_id, COALESCE(SUM(r.reserved_minor), 0)::bigint AS qty
         FROM fin.facility_reservations r
        WHERE r.status = 'OPEN'
        GROUP BY r.facility_id`,
  },
  {
    check_code: 'R051',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'facility_reservations',
    source_query: `SELECT r.id AS entity_id, 1::bigint AS qty
         FROM fin.facility_reservations r
        WHERE r.status = 'CAPTURED'`,
    comparison_query: `SELECT r.id AS entity_id, 1::bigint AS qty
         FROM fin.facility_reservations r
         JOIN fin.ledger_transactions t
           ON t.economic_source_id = r.id
          AND t.economic_source_type = 'FACILITY'
          AND t.shape = 'CAPTURE'
         JOIN fin.ledger_postings p ON p.transaction_id = t.id
         JOIN fin.ledger_accounts a ON a.id = p.account_id AND a.account_type = 'CONSUMED'
        WHERE r.status = 'CAPTURED'`,
  },
  {
    check_code: 'R052',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_AFFECTED_HOLDER',
    entity_type: 'lots',
    source_query: `SELECT l.id AS entity_id, l.remaining_units AS qty
         FROM fin.lots l
        WHERE l.source_kind = 'FACILITY_DRAW'`,
    comparison_query: `SELECT l.id AS entity_id, 0::bigint AS qty
         FROM fin.lots l
        WHERE l.source_kind = 'FACILITY_DRAW'`,
  },
  {
    check_code: 'R053',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'dunning_cases',
    source_query: `SELECT i.id AS entity_id, 1::bigint AS qty
         FROM fin.invoices i
        WHERE i.status IN ('ISSUED', 'PART_PAID') AND i.due_at < now()`,
    comparison_query: `SELECT i.id AS entity_id, 1::bigint AS qty
         FROM fin.invoices i
         JOIN fin.dunning_cases d ON d.invoice_id = i.id
        WHERE i.status IN ('ISSUED', 'PART_PAID') AND i.due_at < now()`,
  },
  {
    check_code: 'R057',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_NEW_ISSUANCE',
    entity_type: 'purchase_intents',
    source_query: "SELECT pi.id AS entity_id, 1::bigint AS qty FROM fin.purchase_intents pi WHERE pi.status = 'PAID'",
    comparison_query: "SELECT pi.id AS entity_id, 1::bigint AS qty FROM fin.purchase_intents pi JOIN fin.ledger_transactions t ON t.economic_source_type = 'PURCHASE_INTENT' AND t.economic_source_id = pi.id AND t.shape = 'FUNDING' WHERE pi.status = 'PAID'",
  },
  {
    check_code: 'R058',
    severity: 'MEDIUM',
    expected_delta_units: 0,
    drift_action: 'WARN',
    entity_type: 'lots',
    source_query: "SELECT l.id AS entity_id, l.consideration_minor AS qty FROM fin.lots l WHERE l.source_kind IN ('PROMOTIONAL_GRANT','COMPENSATION')",
    comparison_query: "SELECT l.id AS entity_id, 0::bigint AS qty FROM fin.lots l WHERE l.source_kind IN ('PROMOTIONAL_GRANT','COMPENSATION')",
  },
  {
    // Stage 9 restatement (DL-127): deferred = recognized + remaining per group.
    check_code: 'R060',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'revenue_allocation_groups',
    source_query: `SELECT g.id AS entity_id, g.amount_minor AS qty
         FROM fin.revenue_allocation_groups g`,
    comparison_query: `SELECT g.id AS entity_id,
         (
           COALESCE((
             SELECT SUM(ae.amount_minor)
               FROM fin.accounting_events ae
              WHERE ae.event_kind = 'REVENUE_RECOGNIZED'
                AND (
                  (ae.source_type = g.source_type AND ae.source_id = g.source_id)
                  OR ae.source_id IN (
                    SELECT l.rated_usage_id
                      FROM fin.revenue_allocation_lines l
                     WHERE l.group_id = g.id AND l.rated_usage_id IS NOT NULL
                  )
                )
           ), 0)
           + g.amount_minor
           - COALESCE((
               SELECT SUM(l.recognized_amount_minor)
                 FROM fin.revenue_allocation_lines l
                WHERE l.group_id = g.id
             ), 0)
         )::bigint AS qty
         FROM fin.revenue_allocation_groups g`,
  },
  {
    // Payments table is Stage 10. Applied payments = 0 (DL-121).
    check_code: 'R061',
    severity: 'CRITICAL',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'accounting_events',
    source_query: `SELECT ae.source_id AS entity_id, SUM(ae.amount_minor)::bigint AS qty
         FROM fin.accounting_events ae
        WHERE ae.event_kind = 'RECEIVABLE_CREATED'
        GROUP BY ae.source_id`,
    comparison_query: `SELECT recv.source_id AS entity_id,
         (
           COALESCE(wo.qty, 0)
           + (recv.qty - COALESCE(wo.qty, 0))
         )::bigint AS qty
         FROM (
           SELECT source_id, SUM(amount_minor)::bigint AS qty
             FROM fin.accounting_events
            WHERE event_kind = 'RECEIVABLE_CREATED'
            GROUP BY source_id
         ) recv
         LEFT JOIN (
           SELECT source_id, SUM(amount_minor)::bigint AS qty
             FROM fin.accounting_events
            WHERE event_kind = 'BAD_DEBT_WRITE_OFF'
            GROUP BY source_id
         ) wo ON wo.source_id = recv.source_id`,
  },
  {
    check_code: 'R062',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'lots',
    source_query: `SELECT l.id AS entity_id,
         COALESCE((
           SELECT SUM(ae.amount_minor)
             FROM fin.accounting_events ae
            WHERE ae.event_kind = 'BREAKAGE_RECOGNIZED'
              AND ae.source_type = 'LOT'
              AND ae.source_id = l.id
         ), 0)::bigint AS qty
         FROM fin.lots l
        WHERE l.status = 'EXPIRED'`,
    comparison_query: `SELECT l.id AS entity_id,
         CASE
           WHEN l.granted_units = 0 THEN 0
           ELSE (l.consideration_minor
             * (l.granted_units - l.remaining_units - COALESCE((
                  SELECT SUM(-a.units)
                    FROM fin.lot_allocations a
                    JOIN fin.ledger_postings p ON p.id = a.posting_id
                    JOIN fin.ledger_transactions t ON t.id = p.transaction_id
                   WHERE a.lot_id = l.id
                     AND a.units < 0
                     AND t.shape <> 'EXPIRY'
                ), 0))
             / l.granted_units)
         END::bigint AS qty
         FROM fin.lots l
        WHERE l.status = 'EXPIRED'`,
  },
  {
    check_code: 'R063',
    severity: 'HIGH',
    expected_delta_units: 0,
    drift_action: 'BLOCK_BILLING_CLOSE',
    entity_type: 'accounting_events',
    source_query: `SELECT ae.id AS entity_id, 1::bigint AS qty
         FROM fin.accounting_events ae`,
    comparison_query: `SELECT ae.id AS entity_id, 1::bigint AS qty
         FROM fin.accounting_events ae
         JOIN fin.accounting_periods ap ON ap.id = ae.accounting_period_id
        WHERE ap.status <> 'HARD_CLOSED'
           OR ae.event_at < ap.ends_at`,
  },
]
