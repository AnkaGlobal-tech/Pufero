import { createWebhookAction } from "../lib/webhooks.server";
import { handleCustomersRedact } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleCustomersRedact);
