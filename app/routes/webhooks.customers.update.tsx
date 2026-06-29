import { createWebhookAction } from "../lib/webhooks.server";
import { handleCustomersUpdate } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleCustomersUpdate);
