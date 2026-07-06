import { getSupabaseAdmin } from "./supabase.server";
import type { LedgerMovementType, LedgerSource } from "../types/loyalty";
import { setCustomerTierAssignment } from "./tier-engine.server";

export interface CustomerDetail {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  shopify_customer_id: number | null;
  total_spend: number;
  order_count: number;
  last_activity_at: string | null;
  created_at: string | null;
  tier_id: string | null;
  tier_name: string | null;
  tier_slug: string | null;
  tier_manual_override: boolean;
  balance: number;
}

export interface LedgerEntry {
  id: string;
  movement_type: LedgerMovementType;
  source: LedgerSource | null;
  points: number;
  description: string | null;
  shopify_order_id: number | null;
  created_by: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown>;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Fetch customer detail (tier + balance). Store isolation enforced. */
export async function getCustomerDetail(
  storeId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, email, first_name, last_name, shopify_customer_id, total_spend, order_count, last_activity_at, created_at, tier_id, tier_manual_override, tier:tiers(name, slug)",
    )
    .eq("store_id", storeId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`customer detail fetch failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const { data: pointsRows, error: balanceError } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("store_id", storeId)
    .eq("customer_id", customerId);

  if (balanceError) {
    throw new Error(`customer balance fetch failed: ${balanceError.message}`);
  }

  const balance = (pointsRows ?? []).reduce(
    (sum, r) => sum + toNumber((r as { points: unknown }).points),
    0,
  );

  const tierRaw = (
    data as unknown as {
      tier:
        | { name: string; slug: string }
        | { name: string; slug: string }[]
        | null;
    }
  ).tier;
  const tier = Array.isArray(tierRaw) ? tierRaw[0] ?? null : tierRaw;

  return {
    id: data.id,
    email: data.email ?? null,
    first_name: data.first_name ?? null,
    last_name: data.last_name ?? null,
    shopify_customer_id: data.shopify_customer_id ?? null,
    total_spend: toNumber(data.total_spend),
    order_count: data.order_count ?? 0,
    last_activity_at: data.last_activity_at ?? null,
    created_at: data.created_at ?? null,
    tier_id: data.tier_id ?? null,
    tier_name: tier?.name ?? null,
    tier_slug: tier?.slug ?? null,
    tier_manual_override: Boolean(data.tier_manual_override),
    balance,
  };
}

/** Customer point movements (newest first). */
export async function getCustomerLedger(
  storeId: string,
  customerId: string,
  limit = 100,
): Promise<LedgerEntry[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("points_ledger")
    .select(
      "id, movement_type, source, points, description, shopify_order_id, created_by, created_at, metadata",
    )
    .eq("store_id", storeId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`customer ledger fetch failed: ${error.message}`);
  }

  return (data as LedgerEntry[]) ?? [];
}

/**
 * Manual point add/remove (Day 7). Positive = credit, negative = debit.
 * Balance updates automatically via append-only ledger.
 */
export async function addManualPoints(params: {
  storeId: string;
  customerId: string;
  points: number;
  reason: string;
  actor: string;
}): Promise<void> {
  if (!Number.isInteger(params.points) || params.points === 0) {
    throw new Error("Points must be a non-zero whole number.");
  }

  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.customerId,
    movement_type: "manual" satisfies LedgerMovementType,
    points: params.points,
    source: "manual" satisfies LedgerSource,
    description: params.reason || "Manual points adjustment",
    metadata: {},
    created_by: params.actor,
  });

  if (error) {
    throw new Error(`manual points insert failed: ${error.message}`);
  }

  await supabase
    .from("customers")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", params.customerId);
}

/** Admin: assign manual tier or revert to automatic (tierId null). */
export async function setCustomerTier(params: {
  storeId: string;
  customerId: string;
  shopDomain: string;
  tierId: string | null;
}): Promise<{ tierName: string }> {
  return setCustomerTierAssignment(params);
}
