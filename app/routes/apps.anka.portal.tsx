import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getPortalPayload } from "../lib/portal.server";

/** App Proxy: GET /apps/anka/portal — logged-in customer account rewards */
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
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");
  const shopifyCustomerId =
    rawCustomerId && rawCustomerId !== "0"
      ? Number.parseInt(rawCustomerId, 10)
      : null;

  if (!shopifyCustomerId || !Number.isFinite(shopifyCustomerId)) {
    return json(
      { ok: false, error: "Sign in to view your rewards." },
      { status: 401 },
    );
  }

  const payload = await getPortalPayload({
    storeId: store.id,
    shopifyCustomerId,
    shopDomain: session.shop,
    locale: url.searchParams.get("locale"),
    currency: url.searchParams.get("currency"),
  });

  if (!payload.ok) {
    return json(payload, { status: 404 });
  }

  return json(payload, {
    headers: {
      "Cache-Control": "private, max-age=0, no-cache",
    },
  });
};
