import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getLandingPayload } from "../lib/landing.server";

/** App Proxy: GET /apps/anka/landing — public rewards program page */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const store = await getStoreByDomain(session.shop);
  if (!store?.is_active) {
    return json({ ok: false, error: "Program unavailable" }, { status: 404 });
  }

  const payload = await getLandingPayload(store.id);
  if (!payload.ok) {
    return json(payload, { status: 404 });
  }

  return json(payload, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
};
