CREATE TABLE IF NOT EXISTS public.webhook_delivery_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider VARCHAR(40) NOT NULL,
  external_id VARCHAR(200) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_time
  ON public.webhook_delivery_log(received_at DESC);
