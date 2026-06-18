import { createWebhookAction } from "../lib/webhooks.server";
import { handleOrdersCreate } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleOrdersCreate);
