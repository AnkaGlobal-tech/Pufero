import { createWebhookAction } from "../lib/webhooks.server";
import { handleCustomersDataRequest } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleCustomersDataRequest);
