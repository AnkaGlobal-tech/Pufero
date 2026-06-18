import { createWebhookAction } from "../lib/webhooks.server";
import { deactivateStoreOnUninstall } from "../lib/store.server";
import db from "../db.server";

export const action = createWebhookAction(async ({ shop }) => {
  await deactivateStoreOnUninstall({ shopDomain: shop });
  await db.session.deleteMany({ where: { shop } });
});
