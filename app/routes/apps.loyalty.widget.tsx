import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getWidgetPayload } from "../lib/widget.server";

/** App Proxy: GET /apps/loyalty/widget */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = await getStoreByDomain(session.shop);

  if (!store?.is_active) {
    return json({ error: "Program unavailable" }, { status: 404 });
  }

  const url = new URL(request.url);
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");
  const shopifyCustomerId =
    rawCustomerId && rawCustomerId !== "0"
      ? Number.parseInt(rawCustomerId, 10)
      : null;

  const payload = await getWidgetPayload({
    storeId: store.id,
    shopifyCustomerId:
      shopifyCustomerId != null && Number.isFinite(shopifyCustomerId)
        ? shopifyCustomerId
        : null,
    locale: url.searchParams.get("locale"),
    currency: url.searchParams.get("currency"),
  });

  return json(payload, {
    headers: {
      "Cache-Control": "private, max-age=0, no-cache",
    },
  });
};
