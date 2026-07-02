import { getSupabaseAdmin } from "./supabase.server";
import type { EarningRuleType, LedgerSource } from "../types/loyalty";

type PurchaseBonusRuleType =
  | "first_order_bonus"
  | "second_order_bonus"
  | "third_order_bonus"
  | "bulk_order_bonus";

const ORDER_SEQUENCE_RULES: Record<number, PurchaseBonusRuleType> = {
  0: "first_order_bonus",
  1: "second_order_bonus",
  2: "third_order_bonus",
};

interface RuleRow {
  rule_type: EarningRuleType;
  enabled: boolean;
  points_value: number;
  config: Record<string, unknown>;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

async function getEnabledPurchaseRules(
  storeId: string,
): Promise<Map<PurchaseBonusRuleType, RuleRow>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .select("rule_type, enabled, points_value, config")
    .eq("store_id", storeId)
    .in("rule_type", [
      "first_order_bonus",
      "second_order_bonus",
      "third_order_bonus",
      "bulk_order_bonus",
    ]);

  if (error) {
    throw new Error(`bonus rules fetch failed: ${error.message}`);
  }

  const map = new Map<PurchaseBonusRuleType, RuleRow>();
  for (const row of data ?? []) {
    if (!row.enabled) continue;
    map.set(row.rule_type as PurchaseBonusRuleType, row as RuleRow);
  }
  return map;
}

async function bonusAlreadyAwarded(
  storeId: string,
  sourceId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", storeId)
    .eq("source_id", sourceId)
    .eq("movement_type", "earn")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`bonus ledger lookup failed: ${error.message}`);
  }
  return data != null;
}

/**
 * Apply sequence and bulk bonuses after purchase/draft.
 * orderCountBefore: customer order count before adjustCustomerTotals.
 */
export async function applyPurchaseBonuses(params: {
  storeId: string;
  customerId: string;
  orderCountBefore: number;
  eligibleAmount: number;
  shopifyOrderId?: number;
  /** Idempotency prefix: "123" (order) or "draft-456" */
  sourceKey: string;
  descriptionPrefix: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const rules = await getEnabledPurchaseRules(params.storeId);
  if (rules.size === 0) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  let totalBonus = 0;

  const sequenceRule = ORDER_SEQUENCE_RULES[params.orderCountBefore];
  if (sequenceRule && rules.has(sequenceRule)) {
    const rule = rules.get(sequenceRule)!;
    const points = Math.max(0, Math.floor(toNumber(rule.points_value)));
    // Sequence bonuses are once per customer — not per order/draft
    const sourceId = `customer-${params.customerId}-bonus-${sequenceRule}`;

    if (points > 0 && !(await bonusAlreadyAwarded(params.storeId, sourceId))) {
      const { error } = await supabase.from("points_ledger").insert({
        store_id: params.storeId,
        customer_id: params.customerId,
        movement_type: "earn",
        points,
        source: sequenceRule as LedgerSource,
        source_id: sourceId,
        shopify_order_id: params.shopifyOrderId ?? null,
        description: `${params.descriptionPrefix} — ${sequenceRule.replace(/_/g, " ")}`,
        metadata: {
          ...params.metadata,
          bonus_rule: sequenceRule,
          order_sequence: params.orderCountBefore + 1,
        },
        created_by: "bonus-rules",
      });
      if (error) {
        throw new Error(`bonus ledger insert failed: ${error.message}`);
      }
      totalBonus += points;
    }
  }

  const bulkRule = rules.get("bulk_order_bonus");
  if (bulkRule) {
    const minTotal = toNumber(bulkRule.config?.min_order_total) || 1200;
    if (params.eligibleAmount >= minTotal) {
      const points = Math.max(0, Math.floor(toNumber(bulkRule.points_value)));
      const sourceId = `${params.sourceKey}-bonus-bulk_order_bonus`;

      if (points > 0 && !(await bonusAlreadyAwarded(params.storeId, sourceId))) {
        const { error } = await supabase.from("points_ledger").insert({
          store_id: params.storeId,
          customer_id: params.customerId,
          movement_type: "earn",
          points,
          source: "bulk_order_bonus",
          source_id: sourceId,
          shopify_order_id: params.shopifyOrderId ?? null,
          description: `${params.descriptionPrefix} — bulk sipariş bonusu`,
          metadata: {
            ...params.metadata,
            bonus_rule: "bulk_order_bonus",
            eligible_amount: params.eligibleAmount,
            min_order_total: minTotal,
          },
          created_by: "bonus-rules",
        });
        if (error) {
          throw new Error(`bulk bonus insert failed: ${error.message}`);
        }
        totalBonus += points;
      }
    }
  }

  if (totalBonus > 0) {
    console.log(
      `[bonus-rules] ${params.sourceKey} +${totalBonus} bonus puan (sıra=${params.orderCountBefore + 1})`,
    );
  }

  return totalBonus;
}

type LifecycleRuleType = "account_creation" | "birthday";

interface ShopifyCustomerPayload {
  id?: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birthday?: string | null;
  metafields?: Array<{
    namespace?: string;
    key?: string;
    value?: string;
  }> | null;
}

async function isProgramPaused(storeId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("program_paused")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    throw new Error(`store pause check failed: ${error?.message ?? "no row"}`);
  }
  return Boolean(data.program_paused);
}

async function getEnabledLifecycleRule(
  storeId: string,
  ruleType: LifecycleRuleType,
): Promise<RuleRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .select("rule_type, enabled, points_value, config")
    .eq("store_id", storeId)
    .eq("rule_type", ruleType)
    .maybeSingle();

  if (error) {
    throw new Error(`lifecycle rule fetch failed: ${error.message}`);
  }
  if (!data?.enabled) {
    return null;
  }
  return data as RuleRow;
}

async function upsertShopifyCustomer(
  storeId: string,
  customer: ShopifyCustomerPayload,
): Promise<{ id: string; shopifyCustomerId: number } | null> {
  if (!customer.id) {
    return null;
  }

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
    .select("id, shopify_customer_id")
    .single();

  if (error || !data) {
    throw new Error(`customer upsert failed: ${error?.message ?? "no row"}`);
  }

  return {
    id: data.id,
    shopifyCustomerId: data.shopify_customer_id as number,
  };
}

async function awardLifecycleBonus(params: {
  storeId: string;
  customerId: string;
  ruleType: LifecycleRuleType;
  sourceId: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const rule = await getEnabledLifecycleRule(params.storeId, params.ruleType);
  if (!rule) {
    return 0;
  }

  const points = Math.max(0, Math.floor(toNumber(rule.points_value)));
  if (points <= 0) {
    return 0;
  }

  if (await bonusAlreadyAwarded(params.storeId, params.sourceId)) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.customerId,
    movement_type: "earn",
    points,
    source: params.ruleType,
    source_id: params.sourceId,
    description: params.description,
    metadata: params.metadata ?? {},
    created_by: "bonus-rules",
  });

  if (error) {
    throw new Error(`lifecycle bonus insert failed: ${error.message}`);
  }

  console.log(
    `[bonus-rules] ${params.sourceId} +${points} ${params.ruleType}`,
  );
  return points;
}

/** customers/create — account creation bonus (one-time). */
export async function applyAccountCreationBonus(params: {
  storeId: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  if (await isProgramPaused(params.storeId)) {
    return 0;
  }

  const customer = params.payload as ShopifyCustomerPayload;
  const row = await upsertShopifyCustomer(params.storeId, customer);
  if (!row) {
    return 0;
  }

  return awardLifecycleBonus({
    storeId: params.storeId,
    customerId: row.id,
    ruleType: "account_creation",
    sourceId: `customer-${row.shopifyCustomerId}-account_creation`,
    description: "Hesap oluşturma bonusu",
  });
}

function normalizeBirthdayDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

/** Extract birthday from customers/update payload (metafield or direct field). */
export function parseBirthdayFromCustomerPayload(
  payload: Record<string, unknown>,
): string | null {
  const customer = payload as ShopifyCustomerPayload;

  if (customer.birthday) {
    return normalizeBirthdayDate(customer.birthday);
  }

  for (const mf of customer.metafields ?? []) {
    const key = `${mf.namespace ?? ""}.${mf.key ?? ""}`.toLowerCase();
    if (
      mf.value &&
      (key.includes("birthday") ||
        key.includes("birth_date") ||
        key.includes("date_of_birth") ||
        mf.key?.toLowerCase() === "birthday")
    ) {
      const normalized = normalizeBirthdayDate(mf.value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

/** customers/update — profile sync + birthday record. */
export async function syncCustomerFromWebhook(params: {
  storeId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const customer = params.payload as ShopifyCustomerPayload;
  const row = await upsertShopifyCustomer(params.storeId, customer);
  if (!row) {
    return;
  }

  const birthday = parseBirthdayFromCustomerPayload(params.payload);
  if (!birthday) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("customers")
    .update({ birthday })
    .eq("id", row.id);

  if (error) {
    throw new Error(`customer birthday update failed: ${error.message}`);
  }
}

function isBirthdayToday(birthday: string, reference: Date): boolean {
  const month = reference.getUTCMonth() + 1;
  const day = reference.getUTCDate();
  const parts = birthday.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return false;
  }
  return parts[1] === month && parts[2] === day;
}

/**
 * Award annual birthday bonus to customers whose birthday is today.
 * Light cron on dashboard load.
 */
export async function processBirthdayBonuses(storeId: string): Promise<number> {
  if (await isProgramPaused(storeId)) {
    return 0;
  }

  const rule = await getEnabledLifecycleRule(storeId, "birthday");
  if (!rule) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, shopify_customer_id, birthday")
    .eq("store_id", storeId)
    .not("birthday", "is", null);

  if (error) {
    throw new Error(`birthday customers fetch failed: ${error.message}`);
  }

  const today = new Date();
  const year = today.getUTCFullYear();
  let awarded = 0;

  for (const customer of customers ?? []) {
    if (!customer.birthday || !customer.shopify_customer_id) {
      continue;
    }
    if (!isBirthdayToday(customer.birthday, today)) {
      continue;
    }

    const points = await awardLifecycleBonus({
      storeId,
      customerId: customer.id,
      ruleType: "birthday",
      sourceId: `customer-${customer.shopify_customer_id}-birthday-${year}`,
      description: `${year} doğum günü bonusu`,
      metadata: { birthday: customer.birthday, year },
    });
    awarded += points;
  }

  if (awarded > 0) {
    console.log(`[bonus-rules] store=${storeId} birthday toplam +${awarded} puan`);
  }

  return awarded;
}
