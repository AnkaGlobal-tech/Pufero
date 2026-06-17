import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deactivateStoreOnUninstall } from "../lib/store.server";
import { captureWebhookFailure } from "../lib/sentry.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await deactivateStoreOnUninstall({ shopDomain: shop });
  } catch (error) {
    captureWebhookFailure(topic, error, { shop });
    console.error(`[${topic}] store deactivate failed:`, error);
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
