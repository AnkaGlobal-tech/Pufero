import { getSupabaseAdmin } from "./supabase.server";
import { listEnabledRedemptions } from "./redemption.server";
import type { RedemptionTier } from "./redemption.server";

import {
  parseWidgetSettings,
  type WidgetSettings,
} from "./widget-settings";
import {
  resolveWidgetCopy,
  interpolateCopy,
  normalizeLocaleCode,
  type WidgetLocaleCopy,
} from "./widget-i18n";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

interface TierRow {
  slug: string;
  name: string;
  threshold_spend: number;
}

function computeTierProgress(params: {
  tiers: TierRow[];
  totalSpend: number;
  currentTierSlug: string | null;
}): {
  progressPercent: number;
  nextTierName: string | null;
  spendToNext: number;
} {
  const sorted = [...params.tiers].sort(
    (a, b) => toNumber(a.threshold_spend) - toNumber(b.threshold_spend),
  );
  if (sorted.length === 0) {
    return { progressPercent: 0, nextTierName: null, spendToNext: 0 };
  }

  const currentIdx = sorted.findIndex((t) => t.slug === params.currentTierSlug);
  const currentTier = currentIdx >= 0 ? sorted[currentIdx] : sorted[0];
  const nextTier = sorted[currentIdx + 1] ?? null;

  if (!nextTier) {
    return { progressPercent: 100, nextTierName: null, spendToNext: 0 };
  }

  const floor = toNumber(currentTier?.threshold_spend ?? 0);
  const ceiling = toNumber(nextTier.threshold_spend);
  const span = Math.max(ceiling - floor, 1);
  const progressPercent = Math.min(
    100,
    Math.max(0, ((params.totalSpend - floor) / span) * 100),
  );

  return {
    progressPercent: Math.round(progressPercent),
    nextTierName: nextTier.name,
    spendToNext: Math.max(0, ceiling - params.totalSpend),
  };
}

export interface WidgetMemberPayload {
  balance: number;
  tierName: string | null;
  tierSlug: string | null;
  totalSpend: number;
  progressPercent: number;
  nextTierName: string | null;
  spendToNext: number;
  redemptions: Array<{
    id: string;
    name: string;
    points_cost: number;
    reward_type: RedemptionTier["reward_type"];
    reward_value: number | null;
    canAfford: boolean;
  }>;
}

export interface WidgetPayload {
  enabled: boolean;
  programPaused: boolean;
  settings: WidgetSettings;
  locale: string;
  currency: string;
  copy: WidgetLocaleCopy;
  pointsPerDollar: number;
  pointsToDollarRatio: number;
  isMember: boolean;
  member: WidgetMemberPayload | null;
  guest: {
    headline: string;
    body: string;
    registerUrl: string;
    loginUrl: string;
  } | null;
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
    throw new Error(`widget balance failed: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => sum + toNumber(row.points), 0);
}

export async function getWidgetPayload(params: {
  storeId: string;
  shopifyCustomerId: number | null;
  locale?: string | null;
  currency?: string | null;
}): Promise<WidgetPayload> {
  const supabase = getSupabaseAdmin();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select(
      "program_paused, points_per_dollar, points_to_dollar_ratio, widget_settings",
    )
    .eq("id", params.storeId)
    .single();

  if (storeError || !store) {
    throw new Error(`widget store fetch failed: ${storeError?.message}`);
  }

  const settings = parseWidgetSettings(store.widget_settings);
  const { locale, copy } = resolveWidgetCopy(
    settings.locales,
    settings.default_locale,
    params.locale ?? settings.default_locale,
  );
  const currency = (params.currency ?? "USD").toUpperCase();
  const pointsPerDollar = toNumber(store.points_per_dollar);

  const guestBody = interpolateCopy(copy.guest_body, {
    points_per_dollar: Math.floor(pointsPerDollar),
  });

  const base: Omit<WidgetPayload, "isMember" | "member" | "guest"> = {
    enabled: settings.enabled,
    programPaused: Boolean(store.program_paused),
    settings,
    locale,
    currency,
    copy,
    pointsPerDollar,
    pointsToDollarRatio: toNumber(store.points_to_dollar_ratio),
  };

  if (!params.shopifyCustomerId) {
    return {
      ...base,
      isMember: false,
      member: null,
      guest: {
        headline: copy.guest_headline,
        body: guestBody,
        registerUrl: "/account/register",
        loginUrl: "/account/login",
      },
    };
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select(
      "id, total_spend, tier:tiers(slug, name, threshold_spend)",
    )
    .eq("store_id", params.storeId)
    .eq("shopify_customer_id", params.shopifyCustomerId)
    .maybeSingle();

  if (customerError) {
    throw new Error(`widget customer fetch failed: ${customerError.message}`);
  }

  if (!customer) {
    return {
      ...base,
      isMember: false,
      member: null,
      guest: {
        headline: copy.guest_headline,
        body: guestBody,
        registerUrl: "/account/register",
        loginUrl: "/account/login",
      },
    };
  }

  const { data: tierRows, error: tiersError } = await supabase
    .from("tiers")
    .select("slug, name, threshold_spend")
    .eq("store_id", params.storeId)
    .order("threshold_spend", { ascending: true });

  if (tiersError) {
    throw new Error(`widget tiers fetch failed: ${tiersError.message}`);
  }

  const tierRaw = (
    customer as unknown as {
      tier:
        | { slug: string; name: string; threshold_spend: number }
        | { slug: string; name: string; threshold_spend: number }[]
        | null;
    }
  ).tier;
  const tier = Array.isArray(tierRaw) ? tierRaw[0] ?? null : tierRaw;

  const balance = await getCustomerBalance(params.storeId, customer.id);
  const progress = computeTierProgress({
    tiers: (tierRows as TierRow[]) ?? [],
    totalSpend: toNumber(customer.total_spend),
    currentTierSlug: tier?.slug ?? null,
  });

  const redemptions = await listEnabledRedemptions(params.storeId);

  return {
    ...base,
    isMember: true,
    member: {
      balance,
      tierName: tier?.name ?? null,
      tierSlug: tier?.slug ?? null,
      totalSpend: toNumber(customer.total_spend),
      ...progress,
      redemptions: redemptions.map((r) => ({
        id: r.id,
        name: r.name,
        points_cost: r.points_cost,
        reward_type: r.reward_type,
        reward_value: r.reward_value,
        canAfford: balance >= r.points_cost,
      })),
    },
    guest: null,
  };
}

export async function getCustomerIdByShopifyId(params: {
  storeId: string;
  shopifyCustomerId: number;
}): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("shopify_customer_id", params.shopifyCustomerId)
    .maybeSingle();

  if (error) {
    throw new Error(`customer lookup failed: ${error.message}`);
  }

  return (data?.id as string | undefined) ?? null;
}
