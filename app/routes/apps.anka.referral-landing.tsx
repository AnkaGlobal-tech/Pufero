import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getReferralLandingPayload } from "../lib/referral-engine.server";
import { parseWidgetSettings } from "../lib/widget-settings";
import { getSupabaseAdmin } from "../lib/supabase.server";

/** App Proxy: GET /apps/anka/referral-landing?ref=CODE — public referral invite page */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const store = await getStoreByDomain(session.shop);
  if (!store?.is_active) {
    return json({ ok: false, error: "Program unavailable" }, { status: 404 });
  }

  const url = new URL(request.url);
  const referralCode = url.searchParams.get("ref")?.trim() ?? "";
  if (!referralCode) {
    return json({ ok: false, error: "Missing referral code." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: storeRow } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", store.id)
    .single();

  const settings = parseWidgetSettings(storeRow?.widget_settings);

  const payload = await getReferralLandingPayload({
    storeId: store.id,
    referralCode,
  });

  if (!payload.ok) {
    return json(payload, { status: 404 });
  }

  return json(
    {
      ok: true,
      referralCode,
      ...payload,
      settings: {
        primaryColor: settings.primary_color,
        backgroundColor: settings.background_color,
        textColor: settings.text_color,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=120",
      },
    },
  );
};
