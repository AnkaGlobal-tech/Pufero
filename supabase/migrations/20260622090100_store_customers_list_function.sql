-- Customer list with balance + tier name (admin Customers page)

CREATE OR REPLACE FUNCTION store_customers_list(p_store_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  tier_name text,
  total_spend numeric,
  order_count integer,
  balance integer,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.email,
    c.first_name,
    c.last_name,
    tr.name AS tier_name,
    c.total_spend,
    c.order_count,
    COALESCE((SELECT sum(pl.points) FROM points_ledger pl WHERE pl.customer_id = c.id), 0)::integer AS balance,
    c.last_activity_at
  FROM customers c
  LEFT JOIN tiers tr ON tr.id = c.tier_id
  WHERE c.store_id = p_store_id
  ORDER BY c.last_activity_at DESC NULLS LAST
  LIMIT 200;
$$;
