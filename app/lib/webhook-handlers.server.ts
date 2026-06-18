import { getSupabaseAdmin } from "./supabase.server";
import type { WebhookHandler } from "./webhooks.server";

/** Gün 5: puan motoru buraya baglanacak */
export const handleOrdersCreate: WebhookHandler = async ({ shop, payload }) => {
  const orderId = payload.id;
  console.log(`[orders/create] shop=${shop} order=${orderId}`);
};

export const handleOrdersCancelled: WebhookHandler = async ({ shop, payload }) => {
  const orderId = payload.id;
  console.log(`[orders/cancelled] shop=${shop} order=${orderId}`);
};

export const handleOrdersEdited: WebhookHandler = async ({ shop, payload }) => {
  const orderId = payload.id;
  console.log(`[orders/edited] shop=${shop} order=${orderId}`);
};

export const handleRefundsCreate: WebhookHandler = async ({ shop, payload }) => {
  const refundId = (payload as { id?: unknown }).id;
  console.log(`[refunds/create] shop=${shop} refund=${refundId}`);
};

export const handleCustomersDataRequest: WebhookHandler = async ({
  shop,
  payload,
  store,
}) => {
  const customer = payload.customer as { id?: number; email?: string } | undefined;
  console.log(
    `[customers/data_request] shop=${shop} store=${store.id} customer=${customer?.id}`,
  );
  // Merchant'a veri saglama sureci — payload webhook_events'te zaten sakli
};

export const handleCustomersRedact: WebhookHandler = async ({
  shop,
  payload,
  store,
}) => {
  const supabase = getSupabaseAdmin();
  const customer = payload.customer as { id?: number } | undefined;
  const shopifyCustomerId = customer?.id;

  if (!shopifyCustomerId) {
    console.warn(`[customers/redact] missing customer id for ${shop}`);
    return;
  }

  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("store_id", store.id)
    .eq("shopify_customer_id", shopifyCustomerId);

  if (error) {
    throw new Error(`customers/redact delete failed: ${error.message}`);
  }

  console.log(
    `[customers/redact] shop=${shop} customer=${shopifyCustomerId} deleted`,
  );
};

export const handleShopRedact: WebhookHandler = async ({ shop, store }) => {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("stores").delete().eq("id", store.id);

  if (error) {
    throw new Error(`shop/redact delete failed: ${error.message}`);
  }

  console.log(`[shop/redact] shop=${shop} store=${store.id} fully deleted`);
};
