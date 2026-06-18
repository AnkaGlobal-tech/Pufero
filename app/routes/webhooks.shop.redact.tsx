import { createWebhookAction } from "../lib/webhooks.server";
import { handleShopRedact } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleShopRedact);
