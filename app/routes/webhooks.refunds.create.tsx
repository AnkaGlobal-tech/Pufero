import { createWebhookAction } from "../lib/webhooks.server";
import { handleRefundsCreate } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleRefundsCreate);
