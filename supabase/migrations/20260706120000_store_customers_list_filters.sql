-- Customer list with optional tier + negative balance filters (admin Customers page)

DROP FUNCTION IF EXISTS store_customers_list(uuid);

CREATE OR REPLACE FUNCTION store_customers_list(
  p_store_id uuid,
  p_tier_slug text DEFAULT NULL,
  p_negative_balance boolean DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  tier_name text,
  tier_slug text,
  total_spend numeric,
  order_count integer,
  balance integer,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH listed AS (
    SELECT
      c.id,
      c.email,
      c.first_name,
      c.last_name,
      tr.name AS tier_name,
      tr.slug AS tier_slug,
      c.total_spend,
      c.order_count,
      COALESCE(
        (SELECT sum(pl.points)::integer FROM points_ledger pl WHERE pl.customer_id = c.id),
        0
      ) AS balance,
      c.last_activity_at
    FROM customers c
    LEFT JOIN tiers tr ON tr.id = c.tier_id
    WHERE c.store_id = p_store_id
  )
  SELECT *
  FROM listed
  WHERE (p_tier_slug IS NULL OR p_tier_slug = '' OR tier_slug = p_tier_slug)
    AND (
      p_negative_balance IS NULL
      OR (p_negative_balance = true AND balance < 0)
      OR (p_negative_balance = false)
    )
  ORDER BY last_activity_at DESC NULLS LAST
  LIMIT 500;
$$;
