import { getSupabaseAdmin } from "./supabase.server";

export interface PointsSetupState {
  setupCompletedAt: string | null;
  backfillCompletedAt: string | null;
  shopCurrency: string | null;
}

function readSetup(raw: unknown): PointsSetupState {
  if (!raw || typeof raw !== "object") {
    return {
      setupCompletedAt: null,
      backfillCompletedAt: null,
      shopCurrency: null,
    };
  }
  const root = raw as Record<string, unknown>;
  const block = (root.points_setup as Record<string, unknown> | undefined) ?? {};
  return {
    setupCompletedAt:
      typeof block.setup_completed_at === "string"
        ? block.setup_completed_at
        : null,
    backfillCompletedAt:
      typeof block.backfill_completed_at === "string"
        ? block.backfill_completed_at
        : null,
    shopCurrency:
      typeof block.shop_currency === "string" ? block.shop_currency : null,
  };
}

export async function getPointsSetupState(
  storeId: string,
): Promise<PointsSetupState> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", storeId)
    .single();

  if (error) {
    throw new Error(`points setup fetch failed: ${error.message}`);
  }

  return readSetup(data?.widget_settings);
}

async function patchPointsSetup(
  storeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", storeId)
    .single();

  if (error) {
    throw new Error(`points setup read failed: ${error.message}`);
  }

  const current =
    data?.widget_settings && typeof data.widget_settings === "object"
      ? (data.widget_settings as Record<string, unknown>)
      : {};
  const prev =
    current.points_setup && typeof current.points_setup === "object"
      ? (current.points_setup as Record<string, unknown>)
      : {};

  const { error: updateError } = await supabase
    .from("stores")
    .update({
      widget_settings: {
        ...current,
        points_setup: { ...prev, ...patch },
      },
    })
    .eq("id", storeId);

  if (updateError) {
    throw new Error(`points setup update failed: ${updateError.message}`);
  }
}

export async function markPointsSetupCompleted(params: {
  storeId: string;
  shopCurrency?: string;
}): Promise<void> {
  await patchPointsSetup(params.storeId, {
    setup_completed_at: new Date().toISOString(),
    ...(params.shopCurrency
      ? { shop_currency: params.shopCurrency.toUpperCase() }
      : {}),
  });
}

export async function markOrderBackfillCompleted(
  storeId: string,
): Promise<void> {
  await patchPointsSetup(storeId, {
    backfill_completed_at: new Date().toISOString(),
  });
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

interface EarnMeta {
  eligible_amount?: number;
  points_per_dollar?: number;
  tier_multiplier?: number;
  campaign_multiplier?: number;
  campaign_eligible_amount?: number;
}

/**
 * Recompute purchase earn rows for a new points-per-currency rate.
 * Append-only: writes adjustment rows so balances match the new rate.
 * Fixed bonuses (first order, bulk, etc.) are left unchanged.
 */
export async function recalculatePurchasePointsForRate(params: {
  storeId: string;
  newPointsPerUnit: number;
}): Promise<{ adjusted: number; deltaTotal: number }> {
  const rate = Math.max(0, params.newPointsPerUnit);
  const supabase = getSupabaseAdmin();

  const { data: earns, error } = await supabase
    .from("points_ledger")
    .select("id, customer_id, points, metadata, source_id")
    .eq("store_id", params.storeId)
    .eq("movement_type", "earn");

  if (error) {
    throw new Error(`recalc list failed: ${error.message}`);
  }

  const purchaseEarns = (earns ?? []).filter((row) => {
    const meta = (row.metadata ?? {}) as EarnMeta;
    return meta.points_per_dollar != null && toNumber(meta.eligible_amount) > 0;
  });

  let adjusted = 0;
  let deltaTotal = 0;

  for (const row of purchaseEarns) {
    const meta = (row.metadata ?? {}) as EarnMeta;
    const eligible = toNumber(meta.eligible_amount);

    const tier = toNumber(meta.tier_multiplier) || 1;
    const campEligible = Math.max(0, toNumber(meta.campaign_eligible_amount));
    const campMult = toNumber(meta.campaign_multiplier) || 1;
    const base = Math.max(0, eligible - campEligible);
    const target = Math.floor(
      base * rate * tier + campEligible * rate * tier * campMult,
    );

    const { data: priorAdjs } = await supabase
      .from("points_ledger")
      .select("points")
      .eq("store_id", params.storeId)
      .like("source_id", `rate-adj:${row.id}%`);

    const adjSum = (priorAdjs ?? []).reduce(
      (sum, a) => sum + toNumber(a.points),
      0,
    );
    const delta = target - (toNumber(row.points) + adjSum);
    if (delta === 0) continue;

    const sourceId = `rate-adj:${row.id}:${Date.now()}`;
    const { error: insertError } = await supabase.from("points_ledger").insert({
      store_id: params.storeId,
      customer_id: row.customer_id,
      movement_type: "manual",
      points: delta,
      source: "manual",
      source_id: sourceId,
      description: `Points rate update → ${rate} pts / currency unit`,
      metadata: {
        rate_adjustment_for: row.id,
        previous_effective: toNumber(row.points) + adjSum,
        new_target: target,
        new_points_per_unit: rate,
        original_source_id: row.source_id,
      },
      created_by: "points_rate_recalc",
    });

    if (insertError) {
      throw new Error(`recalc insert failed: ${insertError.message}`);
    }

    adjusted += 1;
    deltaTotal += delta;
  }

  return { adjusted, deltaTotal };
}
