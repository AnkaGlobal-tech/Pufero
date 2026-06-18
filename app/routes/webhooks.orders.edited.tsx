import { createWebhookAction } from "../lib/webhooks.server";
import { handleOrdersEdited } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleOrdersEdited);
