CREATE OR REPLACE FUNCTION commercial.record_consumption(
  p_tenant_id TEXT,
  p_subscription_id TEXT,
  p_billing_period TEXT,
  p_quota_key TEXT,
  p_amount NUMERIC,
  p_source_event_id TEXT,
  p_metadata JSONB
) RETURNS TABLE(within_allowance NUMERIC, overage NUMERIC, entry_ids TEXT[])
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
  v_amount NUMERIC := GREATEST(0, COALESCE(p_amount, 0));
  v_within NUMERIC;
  v_overage NUMERIC;
  v_entry_ids TEXT[] := ARRAY[]::TEXT[];
  v_entry_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id || p_quota_key || p_billing_period));

  SELECT COALESCE(SUM(amount), 0)
    INTO v_balance
    FROM commercial.ledger_entries
   WHERE tenant_id = p_tenant_id
     AND quota_key = p_quota_key
     AND billing_period = p_billing_period;

  v_within := LEAST(v_amount, GREATEST(0, v_balance));
  v_overage := v_amount - v_within;

  IF v_within > 0 THEN
    INSERT INTO commercial.ledger_entries (
      id, tenant_id, subscription_id, billing_period, type, quota_key,
      amount, source_event_id, metadata
    ) VALUES (
      gen_random_uuid()::TEXT, p_tenant_id, p_subscription_id,
      p_billing_period, 'consumption', p_quota_key, -v_within,
      p_source_event_id, COALESCE(p_metadata, '{}'::JSONB)
    ) RETURNING id INTO v_entry_id;
    v_entry_ids := array_append(v_entry_ids, v_entry_id);
  END IF;

  IF v_overage > 0 THEN
    INSERT INTO commercial.ledger_entries (
      id, tenant_id, subscription_id, billing_period, type, quota_key,
      amount, source_event_id, metadata
    ) VALUES (
      gen_random_uuid()::TEXT, p_tenant_id, p_subscription_id,
      p_billing_period, 'overage', p_quota_key, -v_overage,
      p_source_event_id,
      COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object('overage_units', v_overage)
    ) RETURNING id INTO v_entry_id;
    v_entry_ids := array_append(v_entry_ids, v_entry_id);
  END IF;

  RETURN QUERY SELECT v_within, v_overage, v_entry_ids;
END;
$$;
