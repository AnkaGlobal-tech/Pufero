import type { ActionFunctionArgs } from "@remix-run/node";

import { verifyJudgemeWebhook } from "../lib/judgeme-settings.server";
import { processJudgeMeReviewWebhook } from "../lib/review-engine.server";
import { captureException } from "../lib/sentry.server";

/** POST /webhooks/judgeme?shop=...&token=... — Judge.me review published */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop")?.trim();
  const token = url.searchParams.get("token")?.trim();

  if (!shopDomain || !token) {
    return new Response("Missing shop or token", { status: 400 });
  }

  const verified = await verifyJudgemeWebhook({ shopDomain, token });
  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const payloadShop = String(payload.shop_domain ?? "").trim();
  if (payloadShop && payloadShop !== shopDomain) {
    return new Response("Shop domain mismatch", { status: 403 });
  }

  const event = String(payload.event ?? "");
  if (
    event &&
    !event.includes("review/created") &&
    !event.includes("review/published") &&
    !event.includes("review/updated")
  ) {
    return new Response("Ignored event", { status: 200 });
  }

  try {
    await processJudgeMeReviewWebhook({
      storeId: verified.storeId,
      payload,
    });
    return new Response("OK", { status: 200 });
  } catch (error) {
    captureException(error, {
      scope: "judgeme_webhook",
      shop_domain: shopDomain,
    });
    console.error(`[judgeme] webhook failed for ${shopDomain}:`, error);
    return new Response("Internal error", { status: 500 });
  }
};

export const loader = async () => new Response("POST required", { status: 405 });
