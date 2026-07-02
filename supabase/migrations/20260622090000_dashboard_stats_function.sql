-- Dashboard stats — single-query aggregates (admin Dashboard loader)

CREATE OR REPLACE FUNCTION store_dashboard_stats(p_store_id uuid)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'total_members', (SELECT count(*) FROM customers WHERE store_id = p_store_id),
    'active_members', (SELECT count(*) FROM customers WHERE store_id = p_store_id AND order_count > 0),
    'points_earned', (SELECT COALESCE(sum(points), 0) FROM points_ledger WHERE store_id = p_store_id AND points > 0),
    'points_redeemed', (SELECT COALESCE(sum(abs(points)), 0) FROM points_ledger WHERE store_id = p_store_id AND points < 0),
    'net_points', (SELECT COALESCE(sum(points), 0) FROM points_ledger WHERE store_id = p_store_id),
    'tier_distribution', (
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT tr.name, tr.slug, count(c.id) AS count
        FROM tiers tr
        LEFT JOIN customers c ON c.tier_id = tr.id AND c.store_id = p_store_id
        WHERE tr.store_id = p_store_id
        GROUP BY tr.id, tr.name, tr.slug, tr.sort_order
        ORDER BY tr.sort_order
      ) t
    )
  );
$$;
