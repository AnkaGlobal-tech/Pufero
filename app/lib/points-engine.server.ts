import { getSupabaseAdmin } from "./supabase.server";
import type { StoreRecord } from "./store.server";
import type { LedgerMovementType, LedgerSource } from "../types/loyalty";
import { applyPurchaseBonuses } from "./bonus-rules.server";
import {
  getPurchaseMultiplierForCustomer,
  recalculateCustomerTier,
} from "./tier-engine.server";
import {
  computeEligibleSubtotal,
  type OrderLineItem,
} from "./exclusions.server";
import { getCampaignMultiplier } from "./campaign-engine.server";
import {
  resolveLineItemsForEarn,
  resolveDraftIdForOrder,
} from "./order-line-items.server";

/**
 * Core points engine (Day 5).
 *
 * Scope:
 * - Purchase points: $1 = X points (store.points_per_dollar), subtotal-based
 * - Order cancel: full reversal (cancel_reversal)
 * - Refund (full/partial): proportional reversal (refund_reversal)
 * - Negative balance: allowed via append-only ledger
 *
 * Exclusions + campaign multiplier (Day 10): tax/shipping excluded; subtotal base.
 * Refunds use the same base (refund_line_items subtotal).
 */

interface ShopifyCustomerLite {
  id?: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface ShopifyOrderPayload {
  id?: number;
  subtotal_price?: string | null;
  current_subtotal_price?: string | null;
  total_price?: string | null;
  source_name?: string | null;
  customer?: ShopifyCustomerLite | null;
  line_items?: OrderLineItem[] | null;
}

interface ShopifyDraftOrderPayload {
  id?: number;
  subtotal_price?: string | null;
  status?: string | null;
  customer?: ShopifyCustomerLite | null;
  line_items?: OrderLineItem[] | null;
}

interface ShopifyMoneySet {
  shop_money?: { amount?: string | null } | null;
}

interface ShopifyRefundLineItem {
  subtotal?: number | string | null;
  subtotal_set?: ShopifyMoneySet | null;
}

interface ShopifyRefundPayload {
  id?: number;
  order_id?: number;
  refund_line_items?: ShopifyRefundLineItem[] | null;
}

interface StorePointsConfig {
  pointsPerDollar: number;
  programPaused: boolean;
}

interface CustomerRecord {
  id: string;
  total_spend: number;
  order_count: number;
}

async function getCustomerEarnContext(
  storeId: string,
  shopifyCustomerId: number,
): Promise<{
  customerId: string;
  totalSpend: number;
  lastActivityAt: string | null;
  tierId: string | null;
  tierManualOverride: boolean;
} | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, total_spend, last_activity_at, tier_id, tier_manual_override",
    )
    .eq("store_id", storeId)
    .eq("shopify_customer_id", shopifyCustomerId)
    .maybeSingle();

  if (error) {
    throw new Error(`customer earn context failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    customerId: data.id,
    totalSpend: toNumber(data.total_spend),
    lastActivityAt: data.last_activity_at,
    tierId: data.tier_id,
    tierManualOverride: Boolean(data.tier_manual_override),
  };
}

async function resolvePurchaseMultiplier(
  storeId: string,
  shopifyCustomerId: number,
): Promise<number> {
  const ctx = await getCustomerEarnContext(storeId, shopifyCustomerId);
  if (!ctx) {
    return 1;
  }
  return getPurchaseMultiplierForCustomer({
    storeId,
    customerId: ctx.customerId,
    totalSpend: ctx.totalSpend,
    lastActivityAt: ctx.lastActivityAt,
    tierId: ctx.tierId,
    tierManualOverride: ctx.tierManualOverride,
  });
}

async function syncCustomerTierAfterSpendChange(
  store: StoreRecord,
  customerId: string,
): Promise<void> {
  await recalculateCustomerTier({
    storeId: store.id,
    customerId,
    shopDomain: store.shop_domain,
  });
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function getStorePointsConfig(
  storeId: string,
): Promise<StorePointsConfig> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("points_per_dollar, program_paused")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    throw new Error(`store config fetch failed: ${error?.message ?? "no row"}`);
  }

  return {
    pointsPerDollar: toNumber(data.points_per_dollar),
    programPaused: Boolean(data.program_paused),
  };
}

/** Upsert customer from order/customer payload; returns customer row. */
async function ensureCustomer(
  storeId: string,
  customer: ShopifyCustomerLite,
): Promise<CustomerRecord> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        store_id: storeId,
        shopify_customer_id: customer.id,
        email: customer.email ?? null,
        first_name: customer.first_name ?? null,
        last_name: customer.last_name ?? null,
        last_activity_at: new Date().toISOString(),
      },
      { onConflict: "store_id,shopify_customer_id" },
    )
    .select("id, total_spend, order_count")
    .single();

  if (error || !data) {
    throw new Error(`customer upsert failed: ${error?.message ?? "no row"}`);
  }

  return {
    id: data.id,
    total_spend: toNumber(data.total_spend),
    order_count: data.order_count ?? 0,
  };
}

/** Ledger row exists for store_id + shopify_order_id + movement_type? (idempotency) */
async function ledgerEntryExists(params: {
  storeId: string;
  orderId: number;
  movementType: LedgerMovementType;
  sourceId?: string;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("shopify_order_id", params.orderId)
    .eq("movement_type", params.movementType);

  if (params.sourceId) {
    query = query.eq("source_id", params.sourceId);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    throw new Error(`ledger lookup failed: ${error.message}`);
  }
  return data != null;
}

/** Ledger row exists by source_id? (draft order idempotency) */
async function ledgerEntryExistsBySourceId(params: {
  storeId: string;
  sourceId: string;
  movementType: LedgerMovementType;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("source_id", params.sourceId)
    .eq("movement_type", params.movementType)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`ledger source lookup failed: ${error.message}`);
  }
  return data != null;
}

export function draftOrderSourceId(draftId: number): string {
  return `draft-${draftId}`;
}

async function insertLedger(params: {
  storeId: string;
  customerId: string;
  movementType: LedgerMovementType;
  points: number;
  source: LedgerSource;
  sourceId?: string;
  shopifyOrderId?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.customerId,
    movement_type: params.movementType,
    points: params.points,
    source: params.source,
    source_id: params.sourceId ?? null,
    shopify_order_id: params.shopifyOrderId ?? null,
    description: params.description ?? null,
    metadata: params.metadata ?? {},
    created_by: "points-engine",
  });

  if (error) {
    throw new Error(`ledger insert failed: ${error.message}`);
  }
}

/** Update customer total spend and order count (delta applied). */
async function adjustCustomerTotals(params: {
  customerId: string;
  spendDelta: number;
  orderCountDelta: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: current, error: selectError } = await supabase
    .from("customers")
    .select("total_spend, order_count")
    .eq("id", params.customerId)
    .single();

  if (selectError || !current) {
    throw new Error(
      `customer totals fetch failed: ${selectError?.message ?? "no row"}`,
    );
  }

  const newSpend = Math.max(0, toNumber(current.total_spend) + params.spendDelta);
  const newOrderCount = Math.max(
    0,
    (current.order_count ?? 0) + params.orderCountDelta,
  );

  const { error: updateError } = await supabase
    .from("customers")
    .update({ total_spend: newSpend, order_count: newOrderCount })
    .eq("id", params.customerId);

  if (updateError) {
    throw new Error(`customer totals update failed: ${updateError.message}`);
  }
}

/** Order points base: raw subtotal excluding tax/shipping. */
function orderFallbackSubtotal(order: ShopifyOrderPayload): number {
  const subtotal = order.current_subtotal_price ?? order.subtotal_price;
  return toNumber(subtotal);
}

function orderLineItems(order: ShopifyOrderPayload): OrderLineItem[] {
  return (order.line_items as OrderLineItem[] | undefined) ?? [];
}

async function resolvePurchaseEarn(params: {
  storeId: string;
  shopDomain: string;
  shopifyCustomerId: number;
  lineItems: OrderLineItem[];
  fallbackSubtotal: number;
  pointsPerDollar: number;
}): Promise<{
  eligibleAmount: number;
  excludedAmount: number;
  tierMultiplier: number;
  campaignMultiplier: number;
  campaignId: string | null;
  campaignName: string | null;
  campaignEligibleAmount: number;
  points: number;
}> {
  const { eligibleAmount, excludedAmount } = await computeEligibleSubtotal({
    storeId: params.storeId,
    shopDomain: params.shopDomain,
    lineItems: params.lineItems,
    fallbackSubtotal: params.fallbackSubtotal,
  });

  const [tierMultiplier, campaign] = await Promise.all([
    resolvePurchaseMultiplier(params.storeId, params.shopifyCustomerId),
    getCampaignMultiplier({
      storeId: params.storeId,
      shopDomain: params.shopDomain,
      lineItems: params.lineItems,
      totalEligibleAmount: eligibleAmount,
    }),
  ]);

  const baseAmount = Math.max(0, eligibleAmount - campaign.campaignEligibleAmount);
  const campaignAmount = campaign.campaignEligibleAmount;
  const rate = params.pointsPerDollar;
  const tier = tierMultiplier;
  const mult = campaign.multiplier;

  const points = Math.floor(
    baseAmount * rate * tier + campaignAmount * rate * tier * mult,
  );

  return {
    eligibleAmount,
    excludedAmount,
    tierMultiplier,
    campaignMultiplier: campaign.multiplier,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    campaignEligibleAmount: campaign.campaignEligibleAmount,
    points,
  };
}

/** Backfill missing campaign points on a prior earn row awarded without campaign. */
async function applyMissingCampaignAdjustment(params: {
  storeId: string;
  shopDomain: string;
  customerId: string;
  sourceKey: string;
  shopifyOrderId?: number;
  lineItems: OrderLineItem[];
  fallbackSubtotal: number;
  pointsPerDollar: number;
  shopifyCustomerId: number;
  descriptionPrefix: string;
}): Promise<number> {
  const supabase = getSupabaseAdmin();
  const adjustmentSourceId = `${params.sourceKey}-campaign-adjustment`;

  const { data: existing } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("source_id", adjustmentSourceId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return 0;
  }

  const { data: earnRow } = await supabase
    .from("points_ledger")
    .select("points, metadata")
    .eq("store_id", params.storeId)
    .eq("source_id", params.sourceKey)
    .eq("movement_type", "earn")
    .maybeSingle();

  if (!earnRow) {
    return 0;
  }

  const meta = (earnRow.metadata as { campaign_multiplier?: number } | null) ?? {};
  if (meta.campaign_multiplier != null && meta.campaign_multiplier > 1) {
    return 0;
  }

  const earn = await resolvePurchaseEarn({
    storeId: params.storeId,
    shopDomain: params.shopDomain,
    shopifyCustomerId: params.shopifyCustomerId,
    lineItems: params.lineItems,
    fallbackSubtotal: params.fallbackSubtotal,
    pointsPerDollar: params.pointsPerDollar,
  });

  if (!earn.campaignId || earn.campaignMultiplier <= 1) {
    return 0;
  }

  const delta = earn.points - (earnRow.points ?? 0);
  if (delta <= 0) {
    return 0;
  }

  await insertLedger({
    storeId: params.storeId,
    customerId: params.customerId,
    movementType: "earn",
    points: delta,
    source: "campaign",
    sourceId: adjustmentSourceId,
    shopifyOrderId: params.shopifyOrderId,
    description: `${params.descriptionPrefix} — kampanya düzeltmesi (${earn.campaignName})`,
    metadata: {
      campaign_id: earn.campaignId,
      campaign_multiplier: earn.campaignMultiplier,
      campaign_eligible_amount: earn.campaignEligibleAmount,
      original_points: earnRow.points,
      adjusted_total: earn.points,
    },
  });

  console.log(
    `[campaign-engine] ${params.sourceKey} +${delta} kampanya backfill (${earn.campaignName})`,
  );
  return delta;
}

/** @deprecated Use resolvePurchaseEarn */
function orderEligibleAmount(order: ShopifyOrderPayload): number {
  return orderFallbackSubtotal(order);
}

/** orders/create — award purchase points. */
export async function earnOrderPoints(params: {
  store: StoreRecord;
  payload: Record<string, unknown>;
}): Promise<void> {
  const order = params.payload as ShopifyOrderPayload;
  const orderId = order.id;
  const storeId = params.store.id;

  if (!orderId) {
    console.warn(`[points-engine] orders/create missing order id`);
    return;
  }

  const sourceName = String(order.source_name ?? "");
  if (sourceName === "shopify_draft_order") {
    if (order.customer?.id) {
      const config = await getStorePointsConfig(storeId);
      if (!config.programPaused) {
        const draftId = await resolveDraftIdForOrder(
          params.store.shop_domain,
          orderId,
        );
        if (draftId) {
          const customer = await ensureCustomer(storeId, order.customer);
          const fallback = orderFallbackSubtotal(order);
          const lineItems = await resolveLineItemsForEarn({
            shopDomain: params.store.shop_domain,
            payload: params.payload,
            orderId,
            draftId,
          });
          await applyMissingCampaignAdjustment({
            storeId,
            shopDomain: params.store.shop_domain,
            customerId: customer.id,
            sourceKey: draftOrderSourceId(draftId),
            lineItems,
            fallbackSubtotal: fallback,
            pointsPerDollar: config.pointsPerDollar,
            shopifyCustomerId: order.customer.id,
            descriptionPrefix: `Taslak sipariş #${draftId}`,
          });
        }
      }
    }
    console.log(
      `[points-engine] order=${orderId} taslaktan tamamlandı — puan taslakta verildi, kampanya kontrol edildi`,
    );
    return;
  }

  if (!order.customer?.id) {
    console.log(
      `[points-engine] order=${orderId} guest checkout (no customer) — puan atlanıyor`,
    );
    return;
  }

  const config = await getStorePointsConfig(storeId);
  if (config.programPaused) {
    console.log(`[points-engine] store=${storeId} program duraklatılmış — puan atlanıyor`);
    return;
  }

  if (await ledgerEntryExists({ storeId, orderId, movementType: "earn" })) {
    const customer = await ensureCustomer(storeId, order.customer);
    const fallback = orderFallbackSubtotal(order);
    const lineItems = await resolveLineItemsForEarn({
      shopDomain: params.store.shop_domain,
      payload: params.payload,
      orderId,
    });
    await applyMissingCampaignAdjustment({
      storeId,
      shopDomain: params.store.shop_domain,
      customerId: customer.id,
      sourceKey: String(orderId),
      shopifyOrderId: orderId,
      lineItems,
      fallbackSubtotal: fallback,
      pointsPerDollar: config.pointsPerDollar,
      shopifyCustomerId: order.customer.id,
      descriptionPrefix: `Sipariş #${orderId}`,
    });
    console.log(`[points-engine] order=${orderId} earn zaten işlenmiş — kampanya kontrol edildi`);
    return;
  }

  const fallback = orderFallbackSubtotal(order);
  const lineItems = await resolveLineItemsForEarn({
    shopDomain: params.store.shop_domain,
    payload: params.payload,
    orderId,
  });
  const earn = await resolvePurchaseEarn({
    storeId,
    shopDomain: params.store.shop_domain,
    shopifyCustomerId: order.customer.id,
    lineItems,
    fallbackSubtotal: fallback,
    pointsPerDollar: config.pointsPerDollar,
  });

  const customer = await ensureCustomer(storeId, order.customer);

  if (earn.points > 0) {
    await insertLedger({
      storeId,
      customerId: customer.id,
      movementType: "earn",
      points: earn.points,
      source: earn.campaignId ? "campaign" : "purchase",
      sourceId: String(orderId),
      shopifyOrderId: orderId,
      description: earn.campaignName
        ? `Sipariş #${orderId} — ${earn.campaignName}`
        : `Sipariş #${orderId} satın alma puanı`,
      metadata: {
        eligible_amount: earn.eligibleAmount,
        excluded_amount: earn.excludedAmount,
        points_per_dollar: config.pointsPerDollar,
        tier_multiplier: earn.tierMultiplier,
        campaign_multiplier: earn.campaignMultiplier,
        campaign_eligible_amount: earn.campaignEligibleAmount,
        campaign_id: earn.campaignId,
      },
    });
  }

  const bonusPoints = await applyPurchaseBonuses({
    storeId,
    customerId: customer.id,
    orderCountBefore: customer.order_count,
    eligibleAmount: earn.eligibleAmount,
    shopifyOrderId: orderId,
    sourceKey: String(orderId),
    descriptionPrefix: `Sipariş #${orderId}`,
  });

  await adjustCustomerTotals({
    customerId: customer.id,
    spendDelta: earn.eligibleAmount,
    orderCountDelta: 1,
  });

  await syncCustomerTierAfterSpendChange(params.store, customer.id);

  console.log(
    `[points-engine] order=${orderId} +${earn.points} puan (tier x${earn.tierMultiplier}, kampanya x${earn.campaignMultiplier}) +${bonusPoints} bonus (taban $${earn.eligibleAmount})`,
  );
}

/** draft_orders/create or sync — draft order points. Idempotent. */
export async function earnDraftOrderPoints(params: {
  store: StoreRecord;
  payload: Record<string, unknown>;
}): Promise<number> {
  const draft = params.payload as ShopifyDraftOrderPayload;
  const draftId = draft.id;
  const storeId = params.store.id;

  if (!draftId) {
    console.warn(`[points-engine] draft order missing id`);
    return 0;
  }

  const status = String(draft.status ?? "open").toLowerCase();
  if (status === "completed") {
    return 0;
  }

  if (!draft.customer?.id) {
    console.log(
      `[points-engine] draft=${draftId} müşteri yok — puan atlanıyor`,
    );
    return 0;
  }

  const config = await getStorePointsConfig(storeId);
  if (config.programPaused) {
    return 0;
  }

  const sourceId = draftOrderSourceId(draftId);
  const alreadyEarned = await ledgerEntryExistsBySourceId({
    storeId,
    sourceId,
    movementType: "earn",
  });

  const fallback = toNumber(draft.subtotal_price);
  const lineItems = await resolveLineItemsForEarn({
    shopDomain: params.store.shop_domain,
    payload: params.payload,
    draftId,
  });
  const customer = await ensureCustomer(storeId, draft.customer);
  let points = 0;
  let earnMeta = {
    eligibleAmount: fallback,
    tierMultiplier: 1,
    campaignMultiplier: 1,
    campaignId: null as string | null,
    campaignName: null as string | null,
    excludedAmount: 0,
    campaignEligibleAmount: 0,
  };

  if (alreadyEarned) {
    points += await applyMissingCampaignAdjustment({
      storeId,
      shopDomain: params.store.shop_domain,
      customerId: customer.id,
      sourceKey: sourceId,
      lineItems,
      fallbackSubtotal: fallback,
      pointsPerDollar: config.pointsPerDollar,
      shopifyCustomerId: draft.customer.id,
      descriptionPrefix: `Taslak sipariş #${draftId}`,
    });
  }

  if (!alreadyEarned) {
    const earn = await resolvePurchaseEarn({
      storeId,
      shopDomain: params.store.shop_domain,
      shopifyCustomerId: draft.customer.id,
      lineItems,
      fallbackSubtotal: fallback,
      pointsPerDollar: config.pointsPerDollar,
    });
    points = earn.points;
    earnMeta = earn;

    if (points > 0) {
      await insertLedger({
        storeId,
        customerId: customer.id,
        movementType: "earn",
        points,
        source: earn.campaignId ? "campaign" : "purchase",
        sourceId,
        description: earn.campaignName
          ? `Taslak sipariş #${draftId} — ${earn.campaignName}`
          : `Taslak sipariş #${draftId} puanı`,
        metadata: {
          draft_order_id: draftId,
          eligible_amount: earn.eligibleAmount,
          excluded_amount: earn.excludedAmount,
          points_per_dollar: config.pointsPerDollar,
          tier_multiplier: earn.tierMultiplier,
          campaign_multiplier: earn.campaignMultiplier,
          campaign_eligible_amount: earn.campaignEligibleAmount,
          campaign_id: earn.campaignId,
        },
      });
    }

    await adjustCustomerTotals({
      customerId: customer.id,
      spendDelta: earn.eligibleAmount,
      orderCountDelta: 1,
    });

    await syncCustomerTierAfterSpendChange(params.store, customer.id);
  }

  let bonusPoints = 0;
  if (!alreadyEarned) {
    const bonusEligible =
      earnMeta.eligibleAmount > 0 ? earnMeta.eligibleAmount : fallback;

    bonusPoints = await applyPurchaseBonuses({
      storeId,
      customerId: customer.id,
      orderCountBefore: customer.order_count,
      eligibleAmount: bonusEligible,
      sourceKey: sourceId,
      descriptionPrefix: `Taslak sipariş #${draftId}`,
      metadata: { draft_order_id: draftId },
    });
  }

  console.log(
    `[points-engine] draft=${draftId} +${points} puan (tier x${earnMeta.tierMultiplier}, kampanya x${earnMeta.campaignMultiplier}) +${bonusPoints} bonus`,
  );
  return points + bonusPoints;
}

/** draft_orders/delete — reverse draft order points. */
export async function reverseDraftOrderOnDelete(params: {
  store: StoreRecord;
  payload: Record<string, unknown>;
}): Promise<void> {
  const draftId = (params.payload as ShopifyDraftOrderPayload).id;
  const storeId = params.store.id;

  if (!draftId) {
    return;
  }

  const sourceId = draftOrderSourceId(draftId);
  const reversalSourceId = `${sourceId}-delete`;

  if (
    await ledgerEntryExistsBySourceId({
      storeId,
      sourceId: reversalSourceId,
      movementType: "cancel_reversal",
    })
  ) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("points_ledger")
    .select("points, customer_id, metadata")
    .eq("store_id", storeId)
    .or(`source_id.eq.${sourceId},source_id.like.${sourceId}-bonus-%`);

  if (error) {
    throw new Error(`draft delete ledger fetch failed: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    return;
  }

  const netPoints = rows.reduce((sum, r) => sum + (r.points ?? 0), 0);
  const customerId = rows[0].customer_id as string;
  const eligibleAmount =
    (rows[0].metadata as { eligible_amount?: number } | null)?.eligible_amount ?? 0;

  if (netPoints !== 0) {
    await insertLedger({
      storeId,
      customerId,
      movementType: "cancel_reversal",
      points: -netPoints,
      source: "purchase",
      sourceId: reversalSourceId,
      description: `Taslak sipariş #${draftId} silindi — puan geri alındı`,
    });
  }

  await adjustCustomerTotals({
    customerId,
    spendDelta: -toNumber(eligibleAmount),
    orderCountDelta: -1,
  });

  await syncCustomerTierAfterSpendChange(params.store, customerId);
}

/** orders/cancelled — zero out all point effects for the order. */
export async function reverseOrderOnCancel(params: {
  store: StoreRecord;
  payload: Record<string, unknown>;
}): Promise<void> {
  const order = params.payload as ShopifyOrderPayload;
  const orderId = order.id;
  const storeId = params.store.id;

  if (!orderId) {
    console.warn(`[points-engine] orders/cancelled missing order id`);
    return;
  }

  if (
    await ledgerEntryExists({ storeId, orderId, movementType: "cancel_reversal" })
  ) {
    console.log(`[points-engine] order=${orderId} cancel zaten işlenmiş — atlanıyor`);
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("points_ledger")
    .select("points, customer_id")
    .eq("store_id", storeId)
    .eq("shopify_order_id", orderId);

  if (error) {
    throw new Error(`cancel ledger fetch failed: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    console.log(`[points-engine] order=${orderId} için ledger yok — cancel atlanıyor`);
    return;
  }

  const netPoints = rows.reduce((sum, r) => sum + (r.points ?? 0), 0);
  const customerId = rows[0].customer_id as string;

  if (netPoints !== 0) {
    await insertLedger({
      storeId,
      customerId,
      movementType: "cancel_reversal",
      points: -netPoints,
      source: "purchase",
      sourceId: String(orderId),
      shopifyOrderId: orderId,
      description: `Sipariş #${orderId} iptali — puan geri alındı`,
    });
  }

  await adjustCustomerTotals({
    customerId,
    spendDelta: -orderEligibleAmount(order),
    orderCountDelta: -1,
  });

  await syncCustomerTierAfterSpendChange(params.store, customerId);

  console.log(
    `[points-engine] order=${orderId} iptal — ${netPoints} puan geri alındı`,
  );
}

/** refunds/create — proportional point reversal by refunded subtotal. */
export async function reverseOrderOnRefund(params: {
  store: StoreRecord;
  payload: Record<string, unknown>;
}): Promise<void> {
  const refund = params.payload as ShopifyRefundPayload;
  const refundId = refund.id;
  const orderId = refund.order_id;
  const storeId = params.store.id;

  if (!refundId || !orderId) {
    console.warn(`[points-engine] refunds/create missing refund/order id`);
    return;
  }

  if (
    await ledgerEntryExists({
      storeId,
      orderId,
      movementType: "refund_reversal",
      sourceId: String(refundId),
    })
  ) {
    console.log(`[points-engine] refund=${refundId} zaten işlenmiş — atlanıyor`);
    return;
  }

  const refundedSubtotal = (refund.refund_line_items ?? []).reduce(
    (sum, li) =>
      sum +
      toNumber(li.subtotal_set?.shop_money?.amount ?? li.subtotal ?? 0),
    0,
  );

  if (refundedSubtotal <= 0) {
    console.log(
      `[points-engine] refund=${refundId} ara tutar iadesi yok (kargo/vergi) — puan atlanıyor`,
    );
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: earnRow, error } = await supabase
    .from("points_ledger")
    .select("customer_id, metadata")
    .eq("store_id", storeId)
    .eq("shopify_order_id", orderId)
    .eq("movement_type", "earn")
    .maybeSingle();

  if (error) {
    throw new Error(`refund earn lookup failed: ${error.message}`);
  }

  if (!earnRow) {
    console.log(
      `[points-engine] refund=${refundId} order=${orderId} için earn yok — atlanıyor`,
    );
    return;
  }

  const config = await getStorePointsConfig(storeId);
  const rateRaw = (earnRow.metadata as { points_per_dollar?: number } | null)
    ?.points_per_dollar;
  const pointsPerDollar = toNumber(rateRaw) || config.pointsPerDollar;
  const points = Math.floor(refundedSubtotal * pointsPerDollar);
  const customerId = earnRow.customer_id as string;

  if (points > 0) {
    await insertLedger({
      storeId,
      customerId,
      movementType: "refund_reversal",
      points: -points,
      source: "purchase",
      sourceId: String(refundId),
      shopifyOrderId: orderId,
      description: `Sipariş #${orderId} iadesi — ${points} puan geri alındı`,
      metadata: { refunded_subtotal: refundedSubtotal },
    });
  }

  await adjustCustomerTotals({
    customerId,
    spendDelta: -refundedSubtotal,
    orderCountDelta: 0,
  });

  await syncCustomerTierAfterSpendChange(params.store, customerId);

  console.log(
    `[points-engine] refund=${refundId} order=${orderId} -${points} puan (iade $${refundedSubtotal})`,
  );
}
