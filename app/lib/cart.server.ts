import { getSupabaseAdmin } from "./supabase.server";
import { parseWidgetSettings } from "./widget-settings";
import { getCustomerIdByShopifyId } from "./widget.server";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
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
    throw new Error(`cart balance failed: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => sum + toNumber(row.points), 0);
}

export interface CartSliderPayload {
  ok: true;
  enabled: boolean;
  isMember: boolean;
  balance: number;
  pointsToDollarRatio: number;
  minPoints: number;
  maxPoints: number;
  step: number;
  settings: {
    primaryColor: string;
    backgroundColor: string;
    textColor: string;
  };
}

export async function getCartSliderPayload(params: {
  storeId: string;
  shopifyCustomerId: number | null;
}): Promise<CartSliderPayload | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();
  const { data: store, error } = await supabase
    .from("stores")
    .select("program_paused, points_to_dollar_ratio, widget_settings")
    .eq("id", params.storeId)
    .single();

  if (error || !store) {
    return { ok: false, error: "Program unavailable." };
  }

  const settings = parseWidgetSettings(store.widget_settings);
  if (!settings.cart_slider_enabled || store.program_paused) {
    return {
      ok: true,
      enabled: false,
      isMember: false,
      balance: 0,
      pointsToDollarRatio: 0,
      minPoints: 0,
      maxPoints: 0,
      step: 0,
      settings: {
        primaryColor: settings.primary_color,
        backgroundColor: settings.background_color,
        textColor: settings.text_color,
      },
    };
  }

  const ratio = Math.max(1, Math.floor(toNumber(store.points_to_dollar_ratio)));
  const configuredMin = settings.cart_slider_min_points;
  const minPoints = configuredMin > 0 ? configuredMin : ratio;

  if (!params.shopifyCustomerId) {
    return {
      ok: true,
      enabled: true,
      isMember: false,
      balance: 0,
      pointsToDollarRatio: ratio,
      minPoints,
      maxPoints: 0,
      step: ratio,
      settings: {
        primaryColor: settings.primary_color,
        backgroundColor: settings.background_color,
        textColor: settings.text_color,
      },
    };
  }

  const customerId = await getCustomerIdByShopifyId({
    storeId: params.storeId,
    shopifyCustomerId: params.shopifyCustomerId,
  });

  if (!customerId) {
    return {
      ok: true,
      enabled: true,
      isMember: false,
      balance: 0,
      pointsToDollarRatio: ratio,
      minPoints,
      maxPoints: 0,
      step: ratio,
      settings: {
        primaryColor: settings.primary_color,
        backgroundColor: settings.background_color,
        textColor: settings.text_color,
      },
    };
  }

  const balance = await getCustomerBalance(params.storeId, customerId);
  const cap =
    settings.cart_slider_max_points > 0
      ? settings.cart_slider_max_points
      : balance;
  const maxPoints = Math.max(
    0,
    Math.floor(Math.min(balance, cap) / ratio) * ratio,
  );

  return {
    ok: true,
    enabled: true,
    isMember: true,
    balance,
    pointsToDollarRatio: ratio,
    minPoints: Math.min(minPoints, maxPoints || minPoints),
    maxPoints,
    step: ratio,
    settings: {
      primaryColor: settings.primary_color,
      backgroundColor: settings.background_color,
      textColor: settings.text_color,
    },
  };
}
