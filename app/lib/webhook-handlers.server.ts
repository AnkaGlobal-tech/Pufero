import { getSupabaseAdmin } from "./supabase.server";
import type { WebhookHandler } from "./webhooks.server";
import {
  earnOrderPoints,
  reverseOrderOnCancel,
  reverseOrderOnRefund,
  earnDraftOrderPoints,
  reverseDraftOrderOnDelete,
} from "./points-engine.server";
import {
  applyAccountCreationBonus,
  syncCustomerFromWebhook,
} from "./bonus-rules.server";

export const handleOrdersCreate: WebhookHandler = async ({ shop, payload, store }) => {
  console.log(`[orders/create] shop=${shop} order=${payload.id}`);
  await earnOrderPoints({ store, payload });
};

export const handleOrdersCancelled: WebhookHandler = async ({ shop, payload, store }) => {
  console.log(`[orders/cancelled] shop=${shop} order=${payload.id}`);
  await reverseOrderOnCancel({ store, payload });
};

/** orders/edited: point recalculation deferred — log only for now. */
export const handleOrdersEdited: WebhookHandler = async ({ shop, payload }) => {
  const orderId = payload.id;
  console.log(`[orders/edited] shop=${shop} order=${orderId} (handler pending)`);
};

export const handleRefundsCreate: WebhookHandler = async ({ shop, payload, store }) => {
  const refundId = (payload as { id?: unknown }).id;
  console.log(`[refunds/create] shop=${shop} refund=${refundId}`);
  await reverseOrderOnRefund({ store, payload });
};

export const handleDraftOrdersCreate: WebhookHandler = async ({ shop, payload, store }) => {
  const draftId = payload.id;
  console.log(`[draft_orders/create] shop=${shop} draft=${draftId}`);
  await earnDraftOrderPoints({ store, payload });
};

export const handleDraftOrdersDelete: WebhookHandler = async ({ shop, payload, store }) => {
  const draftId = payload.id;
  console.log(`[draft_orders/delete] shop=${shop} draft=${draftId}`);
  await reverseDraftOrderOnDelete({ store, payload });
};

export const handleCustomersCreate: WebhookHandler = async ({ shop, payload, store }) => {
  const customerId = payload.id;
  console.log(`[customers/create] shop=${shop} customer=${customerId}`);
  await applyAccountCreationBonus({ storeId: store.id, payload });
};

export const handleCustomersUpdate: WebhookHandler = async ({ shop, payload, store }) => {
  const customerId = payload.id;
  console.log(`[customers/update] shop=${shop} customer=${customerId}`);
  await syncCustomerFromWebhook({ storeId: store.id, payload });
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
  // Merchant data request flow — payload already stored in webhook_events
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
