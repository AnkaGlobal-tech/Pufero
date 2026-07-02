-- Anka Loyalty — initial multi-tenant schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE ledger_movement_type AS ENUM (
  'earn',
  'redeem',
  'refund_reversal',
  'cancel_reversal',
  'expired',
  'manual'
);

CREATE TYPE ledger_source AS ENUM (
  'purchase',
  'review_text',
  'review_photo',
  'ugc_video',
  'referral',
  'manual',
  'campaign',
  'birthday',
  'account_creation',
  'first_order_bonus',
  'second_order_bonus',
  'third_order_bonus',
  'bulk_order_bonus'
);

CREATE TYPE earning_rule_type AS ENUM (
  'points_per_dollar',
  'first_order_bonus',
  'second_order_bonus',
  'third_order_bonus',
  'bulk_order_bonus',
  'account_creation',
  'birthday',
  'review_text',
  'review_photo',
  'ugc_video',
  'referral'
);

CREATE TYPE redemption_reward_type AS ENUM (
  'fixed_amount',
  'percentage',
  'free_shipping',
  'free_product'
);

CREATE TYPE exclusion_resource_type AS ENUM ('product', 'collection');

CREATE TYPE webhook_event_status AS ENUM (
  'received',
  'processing',
  'processed',
  'failed'
);

CREATE TYPE expiry_job_status AS ENUM (
  'pending',
  'reminded_30d',
  'reminded_7d',
  'expired',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_points_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'points_ledger is append-only';
END;
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL UNIQUE,
  shopify_shop_id BIGINT,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  program_paused BOOLEAN NOT NULL DEFAULT false,
  points_expiry_months INTEGER CHECK (
    points_expiry_months IS NULL OR points_expiry_months IN (6, 12, 24)
  ),
  points_per_dollar NUMERIC(12, 4) NOT NULL DEFAULT 1,
  points_to_dollar_ratio NUMERIC(12, 4) NOT NULL DEFAULT 100,
  tier_downgrade_after_months INTEGER CHECK (
    tier_downgrade_after_months IS NULL OR tier_downgrade_after_months > 0
  ),
  widget_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  klaviyo_api_key TEXT,
  klaviyo_connected_at TIMESTAMPTZ,
  installed_at TIMESTAMPTZ,
  uninstalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  threshold_spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  points_multiplier NUMERIC(6, 3) NOT NULL DEFAULT 1,
  shopify_customer_tag TEXT NOT NULL,
  benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_customer_id BIGINT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  tier_id UUID REFERENCES tiers(id) ON DELETE SET NULL,
  total_spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  birthday DATE,
  referral_code TEXT,
  referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, shopify_customer_id),
  UNIQUE (store_id, referral_code)
);

CREATE TABLE points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  movement_type ledger_movement_type NOT NULL,
  points INTEGER NOT NULL,
  source ledger_source,
  source_id TEXT,
  shopify_order_id BIGINT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  rule_type earning_rule_type NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  points_value INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, rule_type)
);

CREATE TABLE redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  reward_type redemption_reward_type NOT NULL,
  reward_value NUMERIC(12, 2),
  shopify_product_id BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  multiplier NUMERIC(4, 2) NOT NULL CHECK (multiplier > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  collection_ids BIGINT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  resource_type exclusion_resource_type NOT NULL,
  shopify_resource_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, resource_type, shopify_resource_id)
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_webhook_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  payload JSONB,
  status webhook_event_status NOT NULL DEFAULT 'received',
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE klaviyo_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expiry_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_to_expire INTEGER NOT NULL CHECK (points_to_expire > 0),
  expires_at DATE NOT NULL,
  status expiry_job_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_customers_store_id ON customers(store_id);
CREATE INDEX idx_customers_store_email ON customers(store_id, email);
CREATE INDEX idx_customers_store_tier ON customers(store_id, tier_id);

CREATE INDEX idx_points_ledger_store_customer_created
  ON points_ledger(store_id, customer_id, created_at DESC);
CREATE INDEX idx_points_ledger_customer_created
  ON points_ledger(customer_id, created_at DESC);
CREATE INDEX idx_points_ledger_store_order
  ON points_ledger(store_id, shopify_order_id);

CREATE INDEX idx_rules_store_enabled ON rules(store_id, enabled);
CREATE INDEX idx_redemptions_store_enabled ON redemptions(store_id, enabled);
CREATE INDEX idx_campaigns_store_active ON campaigns(store_id, is_active, starts_at, ends_at);
CREATE INDEX idx_webhook_events_store_status ON webhook_events(store_id, status);
CREATE INDEX idx_klaviyo_events_pending ON klaviyo_events(store_id, synced_at)
  WHERE synced_at IS NULL;
CREATE INDEX idx_expiry_jobs_pending ON expiry_jobs(store_id, status, expires_at)
  WHERE status IN ('pending', 'reminded_30d', 'reminded_7d');

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER stores_set_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tiers_set_updated_at
  BEFORE UPDATE ON tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER rules_set_updated_at
  BEFORE UPDATE ON rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER redemptions_set_updated_at
  BEFORE UPDATE ON redemptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER expiry_jobs_set_updated_at
  BEFORE UPDATE ON expiry_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER points_ledger_append_only
  BEFORE UPDATE OR DELETE ON points_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_points_ledger_mutation();

-- ---------------------------------------------------------------------------
-- RLS — service_role bypass; anon/authenticated denied by default
-- ---------------------------------------------------------------------------

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE expiry_jobs ENABLE ROW LEVEL SECURITY;

-- Future storefront portal: access via store_id JWT claim (disabled for now)
CREATE POLICY store_isolation_select ON stores
  FOR SELECT TO authenticated
  USING (id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY tiers_store_isolation ON tiers
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY customers_store_isolation ON customers
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY points_ledger_store_isolation ON points_ledger
  FOR SELECT TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY rules_store_isolation ON rules
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY redemptions_store_isolation ON redemptions
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY campaigns_store_isolation ON campaigns
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY exclusions_store_isolation ON exclusions
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY webhook_events_store_isolation ON webhook_events
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY klaviyo_events_store_isolation ON klaviyo_events
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

CREATE POLICY expiry_jobs_store_isolation ON expiry_jobs
  FOR ALL TO authenticated
  USING (store_id = ((auth.jwt() ->> 'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt() ->> 'store_id')::uuid));

-- ---------------------------------------------------------------------------
-- Views / helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION customer_points_balance(p_customer_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(points), 0)::INTEGER
  FROM points_ledger
  WHERE customer_id = p_customer_id;
$$;
