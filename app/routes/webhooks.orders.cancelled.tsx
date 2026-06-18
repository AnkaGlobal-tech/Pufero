import { createWebhookAction } from "../lib/webhooks.server";
import { handleOrdersCancelled } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleOrdersCancelled);
