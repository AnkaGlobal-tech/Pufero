import { createWebhookAction } from "../lib/webhooks.server";
import { handleDraftOrdersDelete } from "../lib/webhook-handlers.server";

export const action = createWebhookAction(handleDraftOrdersDelete);
