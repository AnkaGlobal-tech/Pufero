import { randomBytes } from "node:crypto";

import { getSupabaseAdmin } from "./supabase.server";
import { createCustomerPercentageDiscount } from "./redemption.server";

export const REFERRAL_STORAGE_KEY = "anka_ref";

export interface ReferralRuleConfig {
  refereeDiscountPercent: number;
  maxReferralsPerCustomer: number;
}

export interface ReferralStats {
  enabled: boolean;
  code: string | null;
  link: string | null;
  referrerRewardPoints: number;
  refereeDiscountPercent: number;
  successfulReferrals: number;
  pendingReferrals: number;
  maxReferrals: number;
  welcomeCode: string | null;
  message: string;
}

const DEFAULT_CONFIG: ReferralRuleConfig = {
  refereeDiscountPercent: 10,
  maxReferralsPerCustomer: 20,
};

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function parseReferralConfig(raw: unknown): ReferralRuleConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    refereeDiscountPercent:
      toNumber(cfg.referee_discount_percent) || DEFAULT_CONFIG.refereeDiscountPercent,
    maxReferralsPerCustomer: Math.max(
      1,
      Math.floor(
        toNumber(cfg.max_referrals_per_customer) ||
          DEFAULT_CONFIG.maxReferralsPerCustomer,
      ),
    ),
  };
}

function generateReferralCode(): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `REF-${suffix}`;
}

function generateWelcomeCode(): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `WELCOME-${suffix}`;
}

function buildReferralLink(shopDomain: string, code: string): string {
  const host = shopDomain.includes(".")
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
  return `https://${host}/pages/refer?ref=${encodeURIComponent(code)}`;
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

async function getReferralRule(storeId: string): Promise<{
  enabled: boolean;
  points: number;
  config: ReferralRuleConfig;
} | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .select("enabled, points_value, config")
    .eq("store_id", storeId)
    .eq("rule_type", "referral")
    .maybeSingle();

  if (error) {
    throw new Error(`referral rule fetch failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    enabled: Boolean(data.enabled),
    points: Math.floor(toNumber(data.points_value)),
    config: parseReferralConfig(data.config),
  };
}

/** Ensure customer has a unique referral code; returns the code. */
export async function ensureReferralCode(params: {
  storeId: string;
  customerId: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await supabase
    .from("customers")
    .select("referral_code")
    .eq("id", params.customerId)
    .eq("store_id", params.storeId)
    .single();

  if (fetchError || !existing) {
    throw new Error(`customer fetch failed: ${fetchError?.message ?? "no row"}`);
  }

  if (existing.referral_code) {
    return existing.referral_code;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateReferralCode();
    const { data, error } = await supabase
      .from("customers")
      .update({ referral_code: code })
      .eq("id", params.customerId)
      .eq("store_id", params.storeId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();

    if (!error && data?.referral_code) {
      return data.referral_code;
    }

    const { data: retry } = await supabase
      .from("customers")
      .select("referral_code")
      .eq("id", params.customerId)
      .single();

    if (retry?.referral_code) {
      return retry.referral_code;
    }
  }

  throw new Error("Could not assign referral code.");
}

async function countSuccessfulReferrals(
  storeId: string,
  referrerCustomerId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("points_ledger")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("customer_id", referrerCustomerId)
    .eq("source", "referral")
    .eq("movement_type", "earn");

  if (error) {
    throw new Error(`referral count failed: ${error.message}`);
  }
  return count ?? 0;
}

async function countPendingReferrals(
  storeId: string,
  referrerCustomerId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("referred_by_customer_id", referrerCustomerId)
    .eq("order_count", 0);

  if (error) {
    throw new Error(`pending referral count failed: ${error.message}`);
  }
  return count ?? 0;
}

async function referralCompletionExists(
  storeId: string,
  refereeCustomerId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", storeId)
    .eq("source", "referral")
    .eq("source_id", `referral-complete-${refereeCustomerId}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`referral ledger lookup failed: ${error.message}`);
  }
  return data != null;
}

async function insertReferralLedger(params: {
  storeId: string;
  customerId: string;
  points: number;
  sourceId: string;
  shopifyOrderId?: number;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.customerId,
    movement_type: "earn",
    points: params.points,
    source: "referral",
    source_id: params.sourceId,
    shopify_order_id: params.shopifyOrderId ?? null,
    description: params.description,
    metadata: params.metadata ?? {},
    created_by: "referral-engine",
  });

  if (error) {
    throw new Error(`referral ledger insert failed: ${error.message}`);
  }
}

/** Referral link + stats for logged-in customer (portal / widget). */
export async function getReferralStats(params: {
  storeId: string;
  customerId: string;
  shopDomain: string;
}): Promise<ReferralStats> {
  if (await isProgramPaused(params.storeId)) {
    return {
      enabled: false,
      code: null,
      link: null,
      referrerRewardPoints: 0,
      refereeDiscountPercent: DEFAULT_CONFIG.refereeDiscountPercent,
      successfulReferrals: 0,
      pendingReferrals: 0,
      maxReferrals: DEFAULT_CONFIG.maxReferralsPerCustomer,
      welcomeCode: null,
      message: "Referral program is temporarily unavailable.",
    };
  }

  const rule = await getReferralRule(params.storeId);
  if (!rule?.enabled || rule.points <= 0) {
    return {
      enabled: false,
      code: null,
      link: null,
      referrerRewardPoints: rule?.points ?? 0,
      refereeDiscountPercent: rule?.config.refereeDiscountPercent ?? 10,
      successfulReferrals: 0,
      pendingReferrals: 0,
      maxReferrals: rule?.config.maxReferralsPerCustomer ?? 20,
      welcomeCode: null,
      message: "Referral rewards are not enabled for this store.",
    };
  }

  const code = await ensureReferralCode({
    storeId: params.storeId,
    customerId: params.customerId,
  });

  const [successfulReferrals, pendingReferrals] = await Promise.all([
    countSuccessfulReferrals(params.storeId, params.customerId),
    countPendingReferrals(params.storeId, params.customerId),
  ]);

  const supabase = getSupabaseAdmin();
  const { data: refereeRow } = await supabase
    .from("customers")
    .select("id")
    .eq("id", params.customerId)
    .maybeSingle();

  let welcomeCode: string | null = null;
  if (refereeRow) {
    const { data: welcomeLedger } = await supabase
      .from("points_ledger")
      .select("metadata")
      .eq("store_id", params.storeId)
      .eq("customer_id", params.customerId)
      .eq("source", "referral")
      .eq("movement_type", "manual")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const meta = welcomeLedger?.metadata as Record<string, unknown> | null;
    if (meta && typeof meta.discount_code === "string") {
      welcomeCode = meta.discount_code;
    }
  }

  return {
    enabled: true,
    code,
    link: buildReferralLink(params.shopDomain, code),
    referrerRewardPoints: rule.points,
    refereeDiscountPercent: rule.config.refereeDiscountPercent,
    successfulReferrals,
    pendingReferrals,
    maxReferrals: rule.config.maxReferralsPerCustomer,
    welcomeCode,
    message: `Earn ${rule.points} points for each friend who places their first order. Friends get ${rule.config.refereeDiscountPercent}% off.`,
  };
}

/** Public landing payload for ?ref=CODE pages. */
export async function getReferralLandingPayload(params: {
  storeId: string;
  referralCode: string;
}): Promise<
  | {
      ok: true;
      valid: boolean;
      referrerFirstName: string | null;
      refereeDiscountPercent: number;
      referrerRewardPoints: number;
      programPaused: boolean;
    }
  | { ok: false; error: string }
> {
  const supabase = getSupabaseAdmin();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("program_paused")
    .eq("id", params.storeId)
    .single();

  if (storeError || !store) {
    return { ok: false, error: "Program unavailable." };
  }

  const rule = await getReferralRule(params.storeId);
  const config = rule?.config ?? DEFAULT_CONFIG;

  const code = params.referralCode.trim().toUpperCase();
  if (!code) {
    return {
      ok: true,
      valid: false,
      referrerFirstName: null,
      refereeDiscountPercent: config.refereeDiscountPercent,
      referrerRewardPoints: rule?.points ?? 0,
      programPaused: Boolean(store.program_paused),
    };
  }

  const { data: referrer, error: referrerError } = await supabase
    .from("customers")
    .select("first_name")
    .eq("store_id", params.storeId)
    .eq("referral_code", code)
    .maybeSingle();

  if (referrerError) {
    return { ok: false, error: "Could not validate referral link." };
  }

  return {
    ok: true,
    valid: referrer != null && Boolean(rule?.enabled),
    referrerFirstName: referrer?.first_name ?? null,
    refereeDiscountPercent: config.refereeDiscountPercent,
    referrerRewardPoints: rule?.points ?? 0,
    programPaused: Boolean(store.program_paused),
  };
}

export interface ClaimReferralResult {
  claimed: boolean;
  welcomeCode?: string;
  reason?: string;
}

/** Assign referrer + issue referee welcome discount (idempotent). */
export async function claimReferral(params: {
  storeId: string;
  shopDomain: string;
  refereeCustomerId: string;
  shopifyCustomerId: number;
  referralCode: string;
}): Promise<ClaimReferralResult> {
  if (await isProgramPaused(params.storeId)) {
    return { claimed: false, reason: "Program paused." };
  }

  const rule = await getReferralRule(params.storeId);
  if (!rule?.enabled) {
    return { claimed: false, reason: "Referrals disabled." };
  }

  const code = params.referralCode.trim().toUpperCase();
  if (!code) {
    return { claimed: false, reason: "Missing referral code." };
  }

  const supabase = getSupabaseAdmin();

  const { data: referee, error: refereeError } = await supabase
    .from("customers")
    .select("id, referred_by_customer_id, order_count")
    .eq("id", params.refereeCustomerId)
    .eq("store_id", params.storeId)
    .single();

  if (refereeError || !referee) {
    return { claimed: false, reason: "Customer not found." };
  }

  if (referee.referred_by_customer_id) {
    const { data: existingWelcome } = await supabase
      .from("points_ledger")
      .select("metadata")
      .eq("store_id", params.storeId)
      .eq("customer_id", params.refereeCustomerId)
      .eq("source", "referral")
      .eq("movement_type", "manual")
      .limit(1)
      .maybeSingle();

    const meta = existingWelcome?.metadata as Record<string, unknown> | null;
    const existingCode =
      meta && typeof meta.discount_code === "string"
        ? meta.discount_code
        : undefined;

    return {
      claimed: true,
      welcomeCode: existingCode,
      reason: "Already linked to a referrer.",
    };
  }

  if ((referee.order_count ?? 0) > 0) {
    return {
      claimed: false,
      reason: "Referral must be claimed before your first order.",
    };
  }

  const { data: referrer, error: referrerError } = await supabase
    .from("customers")
    .select("id, referral_code")
    .eq("store_id", params.storeId)
    .eq("referral_code", code)
    .maybeSingle();

  if (referrerError || !referrer) {
    return { claimed: false, reason: "Invalid referral code." };
  }

  if (referrer.id === params.refereeCustomerId) {
    return { claimed: false, reason: "You cannot refer yourself." };
  }

  const successful = await countSuccessfulReferrals(
    params.storeId,
    referrer.id,
  );
  const pending = await countPendingReferrals(params.storeId, referrer.id);
  if (successful + pending >= rule.config.maxReferralsPerCustomer) {
    return { claimed: false, reason: "This referral link has reached its limit." };
  }

  const { error: linkError } = await supabase
    .from("customers")
    .update({ referred_by_customer_id: referrer.id })
    .eq("id", params.refereeCustomerId)
    .eq("store_id", params.storeId)
    .is("referred_by_customer_id", null);

  if (linkError) {
    throw new Error(`referral link failed: ${linkError.message}`);
  }

  const welcomeCode = generateWelcomeCode();
  await createCustomerPercentageDiscount({
    shopDomain: params.shopDomain,
    shopifyCustomerId: params.shopifyCustomerId,
    code: welcomeCode,
    percentage: rule.config.refereeDiscountPercent,
    title: `Anka Referral — ${rule.config.refereeDiscountPercent}% welcome`,
  });

  await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.refereeCustomerId,
    movement_type: "manual",
    points: 0,
    source: "referral",
    source_id: `referral-welcome-${params.refereeCustomerId}`,
    description: `Referral welcome coupon: ${welcomeCode}`,
    metadata: {
      discount_code: welcomeCode,
      referrer_customer_id: referrer.id,
      referral_code: code,
    },
    created_by: "referral-engine",
  });

  console.log(
    `[referral-engine] referee=${params.refereeCustomerId} linked to referrer=${referrer.id} code=${welcomeCode}`,
  );

  return { claimed: true, welcomeCode };
}

/** Award referrer when referee completes their first order. */
export async function processReferralOnFirstOrder(params: {
  storeId: string;
  shopDomain: string;
  refereeCustomerId: string;
  shopifyOrderId: number;
  orderCountBefore: number;
}): Promise<number> {
  if (params.orderCountBefore > 0) {
    return 0;
  }

  if (await isProgramPaused(params.storeId)) {
    return 0;
  }

  const rule = await getReferralRule(params.storeId);
  if (!rule?.enabled || rule.points <= 0) {
    return 0;
  }

  if (await referralCompletionExists(params.storeId, params.refereeCustomerId)) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const { data: referee, error: refereeError } = await supabase
    .from("customers")
    .select("id, referred_by_customer_id, shopify_customer_id")
    .eq("id", params.refereeCustomerId)
    .eq("store_id", params.storeId)
    .single();

  if (refereeError || !referee?.referred_by_customer_id) {
    return 0;
  }

  const referrerId = referee.referred_by_customer_id;
  const successful = await countSuccessfulReferrals(params.storeId, referrerId);
  if (successful >= rule.config.maxReferralsPerCustomer) {
    console.log(
      `[referral-engine] referrer=${referrerId} at referral limit — skipping order=${params.shopifyOrderId}`,
    );
    return 0;
  }

  const sourceId = `referral-complete-${params.refereeCustomerId}`;
  await insertReferralLedger({
    storeId: params.storeId,
    customerId: referrerId,
    points: rule.points,
    sourceId,
    shopifyOrderId: params.shopifyOrderId,
    description: `Referral bonus — friend order #${params.shopifyOrderId}`,
    metadata: {
      referee_customer_id: params.refereeCustomerId,
      referee_shopify_customer_id: referee.shopify_customer_id,
    },
  });

  console.log(
    `[referral-engine] order=${params.shopifyOrderId} referrer=${referrerId} +${rule.points} referral`,
  );

  return rule.points;
}
