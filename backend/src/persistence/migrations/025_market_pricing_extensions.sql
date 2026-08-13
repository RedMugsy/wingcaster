-- Market Pricing Intelligence Engine extensions
-- Adds agent-reported sold prices and CSV import tracking.

-- ---------------------------------------------------------------------------
-- Agent-reported transaction prices (crowdsourced sold-price data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.agent_price_reports (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    reporter_id TEXT NOT NULL REFERENCES public.users(id),
    agent_id TEXT REFERENCES public.agents(id),
    property_id TEXT REFERENCES public.properties(id),
    external_property_title TEXT,
    external_property_location TEXT,
    property_type VARCHAR(100),
    bedrooms INTEGER,
    bathrooms INTEGER,
    area_sqm NUMERIC(10,2),
    sold_price NUMERIC(15,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    sold_price_normalized_usd NUMERIC(15,2),
    sold_date DATE,
    source VARCHAR(100) DEFAULT 'agent_report',
    notes TEXT,
    supporting_document_url TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
    reviewed_by TEXT REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_price_reports_status
    ON market_pricing.agent_price_reports(status);
CREATE INDEX IF NOT EXISTS idx_agent_price_reports_property
    ON market_pricing.agent_price_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_agent_price_reports_location
    ON market_pricing.agent_price_reports(external_property_location);
CREATE INDEX IF NOT EXISTS idx_agent_price_reports_sold_date
    ON market_pricing.agent_price_reports(sold_date);

-- ---------------------------------------------------------------------------
-- CSV import audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.csv_import_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    uploaded_by TEXT REFERENCES public.users(id),
    source VARCHAR(100) NOT NULL DEFAULT 'manual_csv',
    filename TEXT,
    rows_received INTEGER DEFAULT 0,
    rows_imported INTEGER DEFAULT 0,
    rows_failed INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Add AI as a formal pricing source type
-- ---------------------------------------------------------------------------
INSERT INTO market_pricing.pricing_sources (source, provider, label, enabled, is_internal, requires_disclaimer, disclaimer, config_json, sort_order)
VALUES (
    'ai_estimated',
    'ai',
    'AI-estimated comparables',
    false,
    false,
    true,
    'Computer-generated estimate for comparison only; not a professional appraisal.',
    '{}'::jsonb,
    10
)
ON CONFLICT (source) DO NOTHING;
