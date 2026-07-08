import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getCustomerIdByShopifyId } from "../lib/widget.server";
import { claimReferral } from "../lib/referral-engine.server";
import { getSupabaseAdmin } from "../lib/supabase.server";

/** App Proxy: POST /apps/loyalty/referral-claim — link referee to referrer + welcome coupon */
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

  const url = new URL(request.url);
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");
  const shopifyCustomerId =
    rawCustomerId && rawCustomerId !== "0"
      ? Number.parseInt(rawCustomerId, 10)
      : null;

  if (!shopifyCustomerId || !Number.isFinite(shopifyCustomerId)) {
    return json(
      { ok: false, error: "Sign in to claim a referral reward." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const referralCode = String(form.get("referral_code") ?? "").trim();
  if (!referralCode) {
    return json({ ok: false, error: "Missing referral code." }, { status: 400 });
  }

  const customerId = await getCustomerIdByShopifyId({
    storeId: store.id,
    shopifyCustomerId,
  });

  let resolvedCustomerId = customerId;
  if (!resolvedCustomerId) {
    const supabase = getSupabaseAdmin();
    const { data: created, error: upsertError } = await supabase
      .from("customers")
      .upsert(
        {
          store_id: store.id,
          shopify_customer_id: shopifyCustomerId,
          last_activity_at: new Date().toISOString(),
        },
        { onConflict: "store_id,shopify_customer_id" },
      )
      .select("id")
      .single();

    if (upsertError || !created) {
      return json(
        { ok: false, error: "Could not create loyalty record." },
        { status: 500 },
      );
    }
    resolvedCustomerId = created.id as string;
  }

  try {
    const result = await claimReferral({
      storeId: store.id,
      shopDomain: session.shop,
      refereeCustomerId: resolvedCustomerId,
      shopifyCustomerId,
      referralCode,
    });

    if (!result.claimed && result.reason) {
      return json({ ok: false, error: result.reason }, { status: 400 });
    }

    return json({
      ok: true,
      claimed: result.claimed,
      welcomeCode: result.welcomeCode ?? null,
      message: result.welcomeCode
        ? `Your ${result.welcomeCode} welcome code is ready.`
        : result.reason ?? "Referral linked.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not claim referral.",
      },
      { status: 500 },
    );
  }
};

export const loader = async () =>
  json({ ok: false, error: "POST required" }, { status: 405 });
