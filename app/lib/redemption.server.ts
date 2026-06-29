import { randomBytes } from "node:crypto";

import { unauthenticated } from "../shopify.server";
import { getSupabaseAdmin } from "./supabase.server";
import type { RedemptionRewardType } from "../types/loyalty";

export interface RedemptionTier {
  id: string;
  name: string;
  points_cost: number;
  reward_type: RedemptionRewardType;
  reward_value: number | null;
  enabled: boolean;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export async function listEnabledRedemptions(
  storeId: string,
): Promise<RedemptionTier[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("redemptions")
    .select("id, name, points_cost, reward_type, reward_value, enabled")
    .eq("store_id", storeId)
    .eq("enabled", true)
    .order("sort_order");

  if (error) {
    throw new Error(`redemptions fetch failed: ${error.message}`);
  }

  return (data as RedemptionTier[]) ?? [];
}

async function getCustomerBalance(
  storeId: string,
  customerId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("store_id", storeId)
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`balance fetch failed: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => sum + toNumber(row.points), 0);
}

function generateDiscountCode(): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `ANKA-${suffix}`;
}

const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_CODE_FREE_SHIPPING_CREATE = `#graphql
  mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

async function createShopifyDiscount(params: {
  shopDomain: string;
  shopifyCustomerId: number;
  redemption: RedemptionTier;
  code: string;
}): Promise<void> {
  const { admin } = await unauthenticated.admin(params.shopDomain);
  const customerGid = `gid://shopify/Customer/${params.shopifyCustomerId}`;
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const common = {
    title: `Anka Loyalty — ${params.redemption.name}`,
    code: params.code,
    startsAt,
    endsAt,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    customerSelection: {
      customers: { add: [customerGid] },
    },
  };

  if (params.redemption.reward_type === "free_shipping") {
    const response = await admin.graphql(DISCOUNT_CODE_FREE_SHIPPING_CREATE, {
      variables: {
        freeShippingCodeDiscount: {
          ...common,
          destination: { all: true },
        },
      },
    });
    const json = await response.json();
    const errors = json.data?.discountCodeFreeShippingCreate?.userErrors ?? [];
    if (errors.length > 0 || json.errors) {
      throw new Error(
        `Ücretsiz kargo kuponu oluşturulamadı: ${JSON.stringify(errors.length ? errors : json.errors)}`,
      );
    }
    return;
  }

  if (params.redemption.reward_type === "free_product") {
    throw new Error("Ücretsiz ürün kuponu henüz desteklenmiyor.");
  }

  const rewardValue = toNumber(params.redemption.reward_value);
  if (rewardValue <= 0) {
    throw new Error("Kupon değeri geçersiz.");
  }

  const customerGets =
    params.redemption.reward_type === "percentage"
      ? {
          value: { percentage: rewardValue / 100 },
          items: { all: true },
        }
      : {
          value: {
            discountAmount: {
              amount: rewardValue,
              appliesOnEachItem: false,
            },
          },
          items: { all: true },
        };

  const response = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
    variables: {
      basicCodeDiscount: {
        ...common,
        customerGets,
      },
    },
  });

  const json = await response.json();
  const errors = json.data?.discountCodeBasicCreate?.userErrors ?? [];
  if (errors.length > 0 || json.errors) {
    throw new Error(
      `Kupon oluşturulamadı: ${JSON.stringify(errors.length ? errors : json.errors)}`,
    );
  }
}

export interface RedeemResult {
  code: string;
  pointsDeducted: number;
  redemptionName: string;
}

/** Puan düş + Shopify tek kullanımlık müşteri kuponu üret. */
export async function redeemPointsForCustomer(params: {
  storeId: string;
  customerId: string;
  redemptionId: string;
  shopDomain: string;
}): Promise<RedeemResult> {
  const supabase = getSupabaseAdmin();

  const { data: redemption, error: redemptionError } = await supabase
    .from("redemptions")
    .select("id, name, points_cost, reward_type, reward_value, enabled")
    .eq("id", params.redemptionId)
    .eq("store_id", params.storeId)
    .single();

  if (redemptionError || !redemption?.enabled) {
    throw new Error("Kupon kademesi bulunamadı veya kapalı.");
  }

  const tier = redemption as RedemptionTier;
  const pointsCost = Math.floor(toNumber(tier.points_cost));
  if (pointsCost <= 0) {
    throw new Error("Geçersiz puan maliyeti.");
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("shopify_customer_id")
    .eq("id", params.customerId)
    .eq("store_id", params.storeId)
    .single();

  if (customerError || !customer?.shopify_customer_id) {
    throw new Error("Müşteri bulunamadı.");
  }

  const balance = await getCustomerBalance(params.storeId, params.customerId);
  if (balance < pointsCost) {
    throw new Error(
      `Yetersiz bakiye (${balance} puan, gerekli ${pointsCost}).`,
    );
  }

  const code = generateDiscountCode();
  const sourceId = `redeem-${params.redemptionId}-${Date.now()}`;

  const { error: ledgerError } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: params.customerId,
    movement_type: "redeem",
    points: -pointsCost,
    source: "manual",
    source_id: sourceId,
    description: `${tier.name} — kupon: ${code}`,
    metadata: {
      redemption_id: params.redemptionId,
      discount_code: code,
      reward_type: tier.reward_type,
    },
    created_by: "redemption-engine",
  });

  if (ledgerError) {
    throw new Error(`Puan düşme başarısız: ${ledgerError.message}`);
  }

  try {
    await createShopifyDiscount({
      shopDomain: params.shopDomain,
      shopifyCustomerId: customer.shopify_customer_id as number,
      redemption: tier,
      code,
    });
  } catch (error) {
    await supabase.from("points_ledger").insert({
      store_id: params.storeId,
      customer_id: params.customerId,
      movement_type: "manual",
      points: pointsCost,
      source: "manual",
      source_id: `${sourceId}-rollback`,
      description: `Kupon hatası — ${pointsCost} puan iade`,
      metadata: { rollback_for: sourceId },
      created_by: "redemption-engine",
    });
    throw error;
  }

  await supabase
    .from("customers")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", params.customerId);

  console.log(
    `[redemption] customer=${params.customerId} -${pointsCost} → ${code}`,
  );

  return {
    code,
    pointsDeducted: pointsCost,
    redemptionName: tier.name,
  };
}
