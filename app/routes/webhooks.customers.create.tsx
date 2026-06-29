import { createWebhookAction } from "../lib/webhooks.server";
import { handleCustomersCreate } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleCustomersCreate);
