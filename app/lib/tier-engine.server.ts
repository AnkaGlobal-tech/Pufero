import { unauthenticated } from "../shopify.server";
import { getSupabaseAdmin } from "./supabase.server";

interface TierDef {
  id: string;
  slug: string;
  name: string;
  threshold_spend: number;
  points_multiplier: number;
  shopify_customer_tag: string;
  sort_order: number;
}

interface CustomerTierContext {
  id: string;
  total_spend: number;
  tier_id: string | null;
  shopify_customer_id: number;
  last_activity_at: string | null;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

async function loadStoreTiers(storeId: string): Promise<TierDef[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tiers")
    .select(
      "id, slug, name, threshold_spend, points_multiplier, shopify_customer_tag, sort_order",
    )
    .eq("store_id", storeId)
    .order("threshold_spend", { ascending: false });

  if (error) {
    throw new Error(`tiers fetch failed: ${error.message}`);
  }
  return (data as TierDef[]) ?? [];
}

async function getTierDowngradeMonths(storeId: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("tier_downgrade_after_months")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    return null;
  }
  const months = data.tier_downgrade_after_months;
  return months != null && months > 0 ? months : null;
}

function pickTierForSpend(tiers: TierDef[], totalSpend: number): TierDef | null {
  if (tiers.length === 0) {
    return null;
  }
  for (const tier of tiers) {
    if (totalSpend >= toNumber(tier.threshold_spend)) {
      return tier;
    }
  }
  return tiers[tiers.length - 1] ?? null;
}

function isInactive(lastActivityAt: string | null, months: number | null): boolean {
  if (!months || !lastActivityAt) {
    return false;
  }
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return new Date(lastActivityAt) < cutoff;
}

/** Effective tier from spend + optional inactivity rule. */
export function resolveEffectiveTier(params: {
  tiers: TierDef[];
  totalSpend: number;
  lastActivityAt: string | null;
  downgradeAfterMonths: number | null;
}): TierDef | null {
  const spendTier = pickTierForSpend(params.tiers, params.totalSpend);
  if (!spendTier) {
    return null;
  }

  if (
    !isInactive(params.lastActivityAt, params.downgradeAfterMonths) ||
    params.downgradeAfterMonths == null
  ) {
    return spendTier;
  }

  const tiersAsc = [...params.tiers].sort((a, b) => a.sort_order - b.sort_order);
  const spendIdx = tiersAsc.findIndex((t) => t.id === spendTier.id);
  if (spendIdx <= 0) {
    return spendTier;
  }
  return tiersAsc[spendIdx - 1] ?? spendTier;
}

/** Purchase point multiplier before order (manual tier or spend-based). */
export async function getPurchaseMultiplierForCustomer(params: {
  storeId: string;
  customerId: string;
  totalSpend?: number;
  lastActivityAt?: string | null;
  tierId?: string | null;
  tierManualOverride?: boolean;
}): Promise<number> {
  const supabase = getSupabaseAdmin();
  let totalSpend = params.totalSpend;
  let lastActivityAt = params.lastActivityAt;
  let tierId = params.tierId;
  let tierManualOverride = params.tierManualOverride;

  if (
    totalSpend == null ||
    tierId === undefined ||
    tierManualOverride === undefined
  ) {
    const { data, error } = await supabase
      .from("customers")
      .select(
        "total_spend, last_activity_at, tier_id, tier_manual_override",
      )
      .eq("id", params.customerId)
      .eq("store_id", params.storeId)
      .single();

    if (error || !data) {
      return 1;
    }
    totalSpend = toNumber(data.total_spend);
    lastActivityAt = data.last_activity_at;
    tierId = data.tier_id;
    tierManualOverride = Boolean(data.tier_manual_override);
  }

  const tiers = await loadStoreTiers(params.storeId);

  if (tierManualOverride && tierId) {
    const manualTier = tiers.find((t) => t.id === tierId);
    const multiplier = toNumber(manualTier?.points_multiplier) || 1;
    return multiplier > 0 ? multiplier : 1;
  }

  const downgradeMonths = await getTierDowngradeMonths(params.storeId);
  const tier = resolveEffectiveTier({
    tiers,
    totalSpend: totalSpend ?? 0,
    lastActivityAt: lastActivityAt ?? null,
    downgradeAfterMonths: downgradeMonths,
  });

  const multiplier = toNumber(tier?.points_multiplier) || 1;
  return multiplier > 0 ? multiplier : 1;
}

/** @deprecated Use getPurchaseMultiplierForCustomer in earn flow */
export async function getPointsMultiplierForCustomer(params: {
  storeId: string;
  totalSpend: number;
  lastActivityAt: string | null;
}): Promise<number> {
  const [tiers, downgradeMonths] = await Promise.all([
    loadStoreTiers(params.storeId),
    getTierDowngradeMonths(params.storeId),
  ]);

  const tier = resolveEffectiveTier({
    tiers,
    totalSpend: params.totalSpend,
    lastActivityAt: params.lastActivityAt,
    downgradeAfterMonths: downgradeMonths,
  });

  const multiplier = toNumber(tier?.points_multiplier) || 1;
  return multiplier > 0 ? multiplier : 1;
}

export interface StoreTierOption {
  id: string;
  slug: string;
  name: string;
  shopify_customer_tag: string;
}

export async function listStoreTiers(
  storeId: string,
): Promise<StoreTierOption[]> {
  const tiers = await loadStoreTiers(storeId);
  return tiers
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      shopify_customer_tag: t.shopify_customer_tag,
    }));
}

const TAGS_REMOVE_MUTATION = `#graphql
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const TAGS_ADD_MUTATION = `#graphql
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

async function syncShopifyTierTags(params: {
  shopDomain: string;
  shopifyCustomerId: number;
  allTierTags: string[];
  newTag: string;
}): Promise<void> {
  try {
    const { admin } = await unauthenticated.admin(params.shopDomain);
    const customerGid = `gid://shopify/Customer/${params.shopifyCustomerId}`;
    const tagsToRemove = params.allTierTags.filter((t) => t !== params.newTag);

    if (tagsToRemove.length > 0) {
      const removeRes = await admin.graphql(TAGS_REMOVE_MUTATION, {
        variables: { id: customerGid, tags: tagsToRemove },
      });
      const removeJson = await removeRes.json();
      const removeErrors =
        removeJson.data?.tagsRemove?.userErrors ??
        (removeJson.errors ? [{ message: JSON.stringify(removeJson.errors) }] : []);
      if (removeErrors.length > 0) {
        console.warn(`[tier-engine] tagsRemove warnings:`, removeErrors);
      }
    }

    const addRes = await admin.graphql(TAGS_ADD_MUTATION, {
      variables: { id: customerGid, tags: [params.newTag] },
    });
    const addJson = await addRes.json();
    const addErrors =
      addJson.data?.tagsAdd?.userErrors ??
      (addJson.errors ? [{ message: JSON.stringify(addJson.errors) }] : []);
    if (addErrors.length > 0) {
      console.warn(`[tier-engine] tagsAdd warnings:`, addErrors);
    }
  } catch (error) {
    console.error(
      `[tier-engine] tag sync failed customer=${params.shopifyCustomerId}:`,
      error,
    );
  }
}

/** Update tier from spend/activity + sync Shopify customer tags. */
export async function recalculateCustomerTier(params: {
  storeId: string;
  customerId: string;
  shopDomain: string;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select(
      "id, total_spend, tier_id, shopify_customer_id, last_activity_at, tier_manual_override",
    )
    .eq("id", params.customerId)
    .eq("store_id", params.storeId)
    .single();

  if (customerError || !customer?.shopify_customer_id) {
    return false;
  }

  if (Boolean(customer.tier_manual_override)) {
    return false;
  }

  const row = customer as CustomerTierContext;
  const [tiers, downgradeMonths] = await Promise.all([
    loadStoreTiers(params.storeId),
    getTierDowngradeMonths(params.storeId),
  ]);

  const targetTier = resolveEffectiveTier({
    tiers,
    totalSpend: toNumber(row.total_spend),
    lastActivityAt: row.last_activity_at,
    downgradeAfterMonths: downgradeMonths,
  });

  if (!targetTier) {
    return false;
  }

  const changed = row.tier_id !== targetTier.id;
  if (changed) {
    const { error: updateError } = await supabase
      .from("customers")
      .update({ tier_id: targetTier.id })
      .eq("id", params.customerId);

    if (updateError) {
      throw new Error(`customer tier update failed: ${updateError.message}`);
    }

    const oldSlug =
      tiers.find((t) => t.id === row.tier_id)?.slug ?? "none";
    console.log(
      `[tier-engine] customer=${params.customerId} ${oldSlug} → ${targetTier.slug}`,
    );
  }

  if (changed || row.tier_id == null) {
    await syncShopifyTierTags({
      shopDomain: params.shopDomain,
      shopifyCustomerId: row.shopify_customer_id,
      allTierTags: tiers.map((t) => t.shopify_customer_tag),
      newTag: targetTier.shopify_customer_tag,
    });
  }

  return changed;
}

/** Assign tier to customers missing tier_id (dashboard backfill). */
export async function backfillMissingTiers(params: {
  storeId: string;
  shopDomain: string;
  limit?: number;
}): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id")
    .eq("store_id", params.storeId)
    .is("tier_id", null)
    .limit(params.limit ?? 50);

  if (error) {
    throw new Error(`tier backfill list failed: ${error.message}`);
  }

  let updated = 0;
  for (const customer of customers ?? []) {
    const changed = await recalculateCustomerTier({
      storeId: params.storeId,
      customerId: customer.id,
      shopDomain: params.shopDomain,
    });
    if (changed) {
      updated += 1;
    }
  }

  return updated;
}

/** Admin: manual tier assignment or revert to automatic (tierId null). */
export async function setCustomerTierAssignment(params: {
  storeId: string;
  customerId: string;
  shopDomain: string;
  tierId: string | null;
}): Promise<{ tierName: string }> {
  const supabase = getSupabaseAdmin();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("shopify_customer_id, tier_id")
    .eq("id", params.customerId)
    .eq("store_id", params.storeId)
    .single();

  if (customerError || !customer?.shopify_customer_id) {
    throw new Error("Customer not found or missing Shopify record.");
  }

  const tiers = await loadStoreTiers(params.storeId);

  if (params.tierId === null) {
    const { error: updateError } = await supabase
      .from("customers")
      .update({ tier_manual_override: false })
      .eq("id", params.customerId);

    if (updateError) {
      throw new Error(`tier reset failed: ${updateError.message}`);
    }

    await recalculateCustomerTier({
      storeId: params.storeId,
      customerId: params.customerId,
      shopDomain: params.shopDomain,
    });

    const { data: updated } = await supabase
      .from("customers")
      .select("tier:tiers(name)")
      .eq("id", params.customerId)
      .single();

    const tierRaw = updated?.tier as { name: string } | { name: string }[] | null;
    const tierName = Array.isArray(tierRaw)
      ? tierRaw[0]?.name ?? "Otomatik"
      : tierRaw?.name ?? "Otomatik";
    return { tierName };
  }

  const targetTier = tiers.find((t) => t.id === params.tierId);
  if (!targetTier) {
    throw new Error("Invalid tier selection.");
  }

  const { error: updateError } = await supabase
    .from("customers")
    .update({
      tier_id: targetTier.id,
      tier_manual_override: true,
    })
    .eq("id", params.customerId);

  if (updateError) {
    throw new Error(`tier assign failed: ${updateError.message}`);
  }

  await syncShopifyTierTags({
    shopDomain: params.shopDomain,
    shopifyCustomerId: customer.shopify_customer_id as number,
    allTierTags: tiers.map((t) => t.shopify_customer_tag),
    newTag: targetTier.shopify_customer_tag,
  });

  console.log(
    `[tier-engine] customer=${params.customerId} manual tier → ${targetTier.slug}`,
  );

  return { tierName: targetTier.name };
}
