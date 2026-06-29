import { createWebhookAction } from "../lib/webhooks.server";
import { handleDraftOrdersCreate } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleDraftOrdersCreate);
