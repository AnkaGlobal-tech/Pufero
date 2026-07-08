import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getCustomerIdByShopifyId } from "../lib/widget.server";
import { redeemFlexiblePointsForCustomer } from "../lib/redemption.server";
import { parseWidgetSettings } from "../lib/widget-settings";
import { getSupabaseAdmin } from "../lib/supabase.server";

/** App Proxy: POST /apps/loyalty/cart-redeem — flexible points → coupon for cart */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const store = await getStoreByDomain(session.shop);
  if (!store?.is_active) {
    return json({ ok: false, error: "Program unavailable" }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data: storeRow, error: storeError } = await supabase
    .from("stores")
    .select("points_to_dollar_ratio, widget_settings")
    .eq("id", store.id)
    .single();

  if (storeError || !storeRow) {
    return json({ ok: false, error: "Store not found." }, { status: 404 });
  }

  const widgetSettings = parseWidgetSettings(storeRow.widget_settings);
  if (!widgetSettings.cart_slider_enabled) {
    return json({ ok: false, error: "Cart slider is disabled." }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");
  const shopifyCustomerId =
    rawCustomerId && rawCustomerId !== "0"
      ? Number.parseInt(rawCustomerId, 10)
      : null;

  if (!shopifyCustomerId || !Number.isFinite(shopifyCustomerId)) {
    return json(
      { ok: false, error: "Sign in to use points at checkout." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const points = Math.floor(Number(form.get("points") ?? 0));
  if (!Number.isFinite(points) || points <= 0) {
    return json({ ok: false, error: "Select a valid points amount." }, { status: 400 });
  }

  const customerId = await getCustomerIdByShopifyId({
    storeId: store.id,
    shopifyCustomerId,
  });

  if (!customerId) {
    return json(
      { ok: false, error: "No loyalty record yet." },
      { status: 404 },
    );
  }

  const ratio = Math.max(
    1,
    Math.floor(Number(storeRow.points_to_dollar_ratio ?? 100)),
  );

  try {
    const result = await redeemFlexiblePointsForCustomer({
      storeId: store.id,
      customerId,
      shopDomain: session.shop,
      points,
      pointsToDollarRatio: ratio,
      minPoints: widgetSettings.cart_slider_min_points || undefined,
      maxPoints: widgetSettings.cart_slider_max_points || undefined,
    });

    return json({
      ok: true,
      code: result.code,
      pointsDeducted: result.pointsDeducted,
      discountLabel: result.redemptionName,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not create coupon.",
      },
      { status: 400 },
    );
  }
};

export const loader = async () =>
  json({ ok: false, error: "POST required" }, { status: 405 });
