-- Monthly report RPC, program health checks, Judge.me integration columns

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS judgeme_webhook_token TEXT,
  ADD COLUMN IF NOT EXISTS judgeme_connected_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION store_monthly_report(
  p_store_id uuid,
  p_year integer,
  p_month integer
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC') AS start_at,
      (
        make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC')
        + interval '1 month'
      ) AS end_at
  ),
  ledger AS (
    SELECT pl.*
    FROM points_ledger pl
    CROSS JOIN bounds b
    WHERE pl.store_id = p_store_id
      AND pl.created_at >= b.start_at
      AND pl.created_at < b.end_at
  )
  SELECT json_build_object(
    'year', p_year,
    'month', p_month,
    'new_members', (
      SELECT count(*)
      FROM customers c
      CROSS JOIN bounds b
      WHERE c.store_id = p_store_id
        AND c.created_at >= b.start_at
        AND c.created_at < b.end_at
    ),
    'active_members', (
      SELECT count(DISTINCT customer_id) FROM ledger
    ),
    'points_earned', (
      SELECT COALESCE(sum(points), 0) FROM ledger WHERE points > 0
    ),
    'points_redeemed', (
      SELECT COALESCE(sum(abs(points)), 0) FROM ledger WHERE points < 0
    ),
    'referral_points', (
      SELECT COALESCE(sum(points), 0)
      FROM ledger
      WHERE points > 0 AND source = 'referral'
    ),
    'review_points', (
      SELECT COALESCE(sum(points), 0)
      FROM ledger
      WHERE points > 0
        AND source IN ('review_text', 'review_photo', 'ugc_video')
    ),
    'orders_with_points', (
      SELECT count(DISTINCT shopify_order_id)
      FROM ledger
      WHERE shopify_order_id IS NOT NULL AND points > 0
    )
  );
$$;

CREATE OR REPLACE FUNCTION store_program_health(p_store_id uuid)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'negative_balance_count', (
      SELECT count(*) FROM (
        SELECT customer_id
        FROM points_ledger
        WHERE store_id = p_store_id
        GROUP BY customer_id
        HAVING sum(points) < 0
      ) t
    ),
    'duplicate_source_ids', (
      SELECT COALESCE(json_agg(row_to_json(d)), '[]'::json)
      FROM (
        SELECT source_id, movement_type, count(*) AS cnt
        FROM points_ledger
        WHERE store_id = p_store_id
          AND source_id IS NOT NULL
        GROUP BY source_id, movement_type
        HAVING count(*) > 1
        ORDER BY count(*) DESC
        LIMIT 20
      ) d
    ),
    'failed_webhooks_7d', (
      SELECT count(*)
      FROM webhook_events
      WHERE store_id = p_store_id
        AND status = 'failed'
        AND created_at >= now() - interval '7 days'
    ),
    'stuck_webhooks', (
      SELECT count(*)
      FROM webhook_events
      WHERE store_id = p_store_id
        AND status = 'processing'
        AND created_at < now() - interval '1 hour'
    )
  );
$$;
