-- Default referral rule config (referee discount % + per-customer limit)

CREATE OR REPLACE FUNCTION seed_store_defaults(p_store_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tiers (
    store_id, slug, name, threshold_spend, discount_percent,
    points_multiplier, shopify_customer_tag, sort_order
  )
  VALUES
    (p_store_id, 'bronze', 'Bronze', 0, 0, 1, 'anka-tier-bronze', 1),
    (p_store_id, 'silver', 'Silver', 500, 5, 1.25, 'anka-tier-silver', 2),
    (p_store_id, 'gold', 'Gold', 1500, 10, 1.5, 'anka-tier-gold', 3),
    (p_store_id, 'certified_pro', 'Certified Pro', 5000, 15, 2, 'anka-tier-certified-pro', 4)
  ON CONFLICT (store_id, slug) DO NOTHING;

  INSERT INTO rules (store_id, rule_type, points_value, config)
  VALUES
    (p_store_id, 'points_per_dollar', 1, '{}'::jsonb),
    (p_store_id, 'first_order_bonus', 100, '{}'::jsonb),
    (p_store_id, 'second_order_bonus', 150, '{}'::jsonb),
    (p_store_id, 'third_order_bonus', 200, '{}'::jsonb),
    (p_store_id, 'bulk_order_bonus', 250, '{"min_order_total": 1200}'::jsonb),
    (p_store_id, 'account_creation', 50, '{}'::jsonb),
    (p_store_id, 'birthday', 100, '{}'::jsonb),
    (p_store_id, 'review_text', 50, '{}'::jsonb),
    (p_store_id, 'review_photo', 150, '{}'::jsonb),
    (p_store_id, 'ugc_video', 850, '{"min": 700, "max": 1000}'::jsonb),
    (p_store_id, 'referral', 400, '{"referee_discount_percent": 10, "max_referrals_per_customer": 20}'::jsonb)
  ON CONFLICT (store_id, rule_type) DO NOTHING;

  INSERT INTO redemptions (
    store_id, name, points_cost, reward_type, reward_value, sort_order
  )
  VALUES
    (p_store_id, '$5 off', 500, 'fixed_amount', 5, 1),
    (p_store_id, '$12 off', 1000, 'fixed_amount', 12, 2),
    (p_store_id, '$35 off', 2500, 'fixed_amount', 35, 3)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Backfill referral config for existing stores (keep custom values if already set)
UPDATE rules
SET config = config || '{"referee_discount_percent": 10, "max_referrals_per_customer": 20}'::jsonb
WHERE rule_type = 'referral'
  AND NOT (config ? 'referee_discount_percent')
  AND NOT (config ? 'max_referrals_per_customer');
