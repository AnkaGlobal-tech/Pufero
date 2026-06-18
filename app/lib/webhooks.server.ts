import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSupabaseAdmin } from "./supabase.server";
import { getStoreByDomain, type StoreRecord } from "./store.server";
import { captureWebhookFailure } from "./sentry.server";

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;

export type WebhookHandlerContext = {
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
  store: StoreRecord;
  webhookEventId: string;
};

export type WebhookHandler = (ctx: WebhookHandlerContext) => Promise<void>;

function calculateNextRetryAt(attempts: number): string {
  const delayMs = RETRY_BASE_MS * Math.pow(2, Math.min(attempts, 4));
  return new Date(Date.now() + delayMs).toISOString();
}

async function claimWebhookEvent(params: {
  storeId: string;
  shopifyWebhookId: string;
  topic: string;
  payload: Record<string, unknown>;
}): Promise<{ eventId: string; skip: boolean }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selectError } = await supabase
    .from("webhook_events")
    .select("id, status, attempts")
    .eq("shopify_webhook_id", params.shopifyWebhookId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`webhook_events select failed: ${selectError.message}`);
  }

  if (existing?.status === "processed") {
    return { eventId: existing.id, skip: true };
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("webhook_events")
      .update({
        status: "processing",
        attempts: (existing.attempts ?? 0) + 1,
        error_message: null,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`webhook_events update failed: ${updateError.message}`);
    }

    return { eventId: existing.id, skip: false };
  }

  const { data: created, error: insertError } = await supabase
    .from("webhook_events")
    .insert({
      store_id: params.storeId,
      shopify_webhook_id: params.shopifyWebhookId,
      topic: params.topic,
      payload: params.payload,
      status: "processing",
      attempts: 1,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { eventId: "", skip: true };
    }
    throw new Error(`webhook_events insert failed: ${insertError.message}`);
  }

  return { eventId: created.id, skip: false };
}

async function markWebhookProcessed(eventId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
      next_retry_at: null,
    })
    .eq("id", eventId);

  if (error) {
    throw new Error(`webhook_events mark processed failed: ${error.message}`);
  }
}

async function markWebhookFailed(
  eventId: string,
  error: unknown,
  attempts: number,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const message = error instanceof Error ? error.message : "Unknown webhook error";
  const shouldRetry = attempts < MAX_RETRY_ATTEMPTS;

  const { error: updateError } = await supabase
    .from("webhook_events")
    .update({
      status: "failed",
      error_message: message,
      next_retry_at: shouldRetry ? calculateNextRetryAt(attempts) : null,
    })
    .eq("id", eventId);

  if (updateError) {
    throw new Error(`webhook_events mark failed failed: ${updateError.message}`);
  }
}

export function createWebhookAction(handler: WebhookHandler) {
  return async ({ request }: ActionFunctionArgs): Promise<Response> => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    const shopifyWebhookId = request.headers.get("X-Shopify-Webhook-Id");

    if (!shopifyWebhookId) {
      console.warn(`[webhook] missing X-Shopify-Webhook-Id for ${topic} @ ${shop}`);
      return new Response("Missing webhook id", { status: 400 });
    }

    const store = await getStoreByDomain(shop);
    if (!store) {
      console.log(`[webhook] no store record for ${shop}, skipping ${topic}`);
      return new Response();
    }

    if (!store.is_active && topic !== "shop/redact") {
      console.log(`[webhook] inactive store ${shop}, skipping ${topic}`);
      return new Response();
    }

    let eventId = "";
    let attempts = 1;

    try {
      const claim = await claimWebhookEvent({
        storeId: store.id,
        shopifyWebhookId,
        topic,
        payload: payload as Record<string, unknown>,
      });

      if (claim.skip) {
        return new Response();
      }

      eventId = claim.eventId;

      const supabase = getSupabaseAdmin();
      const { data: eventRow } = await supabase
        .from("webhook_events")
        .select("attempts")
        .eq("id", eventId)
        .single();

      attempts = eventRow?.attempts ?? 1;

      await handler({
        shop,
        topic,
        payload: payload as Record<string, unknown>,
        store,
        webhookEventId: eventId,
      });

      await markWebhookProcessed(eventId);
      return new Response();
    } catch (error) {
      if (eventId) {
        await markWebhookFailed(eventId, error, attempts);
      }

      captureWebhookFailure(topic, error, {
        shop,
        shopifyWebhookId,
        webhookEventId: eventId || undefined,
      });

      console.error(`[webhook] ${topic} failed for ${shop}:`, error);
      return new Response(null, { status: 500 });
    }
  };
}

/** Internal retry kuyrugu — cron veya manuel tetikleme icin (Gün 5+ handler registry ile genisletilir). */
export async function listRetryableWebhookEvents(limit = 25) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("webhook_events")
    .select("id, store_id, topic, payload, attempts, shopify_webhook_id")
    .eq("status", "failed")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", now)
    .order("next_retry_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`webhook retry list failed: ${error.message}`);
  }

  return data ?? [];
}
