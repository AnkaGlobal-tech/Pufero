import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import {
  getCustomerIdByShopifyId,
  getWidgetPayload,
} from "../lib/widget.server";
import { redeemPointsForCustomer } from "../lib/redemption.server";

/** App Proxy: POST /apps/anka/redeem */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  const store = await getStoreByDomain(session.shop);

  if (!store?.is_active) {
    return json({ ok: false, error: "Program unavailable" }, { status: 404 });
  }

  const url = new URL(request.url);
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");
  const shopifyCustomerId =
    rawCustomerId && rawCustomerId !== "0"
      ? Number.parseInt(rawCustomerId, 10)
      : null;

  if (!shopifyCustomerId || !Number.isFinite(shopifyCustomerId)) {
    return json(
      { ok: false, error: "Kupon için giriş yapmalısınız." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const redemptionId = String(form.get("redemption_id") ?? "").trim();
  if (!redemptionId) {
    return json({ ok: false, error: "Kupon kademesi seçilmedi." }, { status: 400 });
  }

  const customerId = await getCustomerIdByShopifyId({
    storeId: store.id,
    shopifyCustomerId,
  });

  if (!customerId) {
    return json(
      { ok: false, error: "Henüz sadakat kaydınız yok. İlk siparişten sonra tekrar deneyin." },
      { status: 404 },
    );
  }

  try {
    const result = await redeemPointsForCustomer({
      storeId: store.id,
      customerId,
      redemptionId,
      shopDomain: session.shop,
    });

    const widget = await getWidgetPayload({
      storeId: store.id,
      shopifyCustomerId,
    });

    return json({
      ok: true,
      code: result.code,
      pointsDeducted: result.pointsDeducted,
      redemptionName: result.redemptionName,
      balance: widget.member?.balance ?? 0,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Kupon oluşturulamadı.",
      },
      { status: 400 },
    );
  }
};

export const loader = async () =>
  json({ ok: false, error: "POST required" }, { status: 405 });
