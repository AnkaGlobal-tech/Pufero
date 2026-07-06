import { getSupabaseAdmin } from "./supabase.server";
import {
  trackLoyaltyActivity,
  flushPendingKlaviyoEvents,
} from "./klaviyo-sync.server";
import { KLAVIYO_METRICS } from "./klaviyo-constants";

export { KLAVIYO_METRICS, flushPendingKlaviyoEvents, trackLoyaltyActivity };

/** Event queue before / during Klaviyo sync. */
export async function logKlaviyoEvent(params: {
  storeId: string;
  customerId?: string | null;
  eventName: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("klaviyo_events").insert({
    store_id: params.storeId,
    customer_id: params.customerId ?? null,
    event_name: params.eventName,
    payload: params.payload ?? {},
  });

  if (error) {
    console.error(`[klaviyo-events] log failed: ${error.message}`);
  }
}

/** Queue + push when customer earns points. */
export async function notifyPointsEarned(params: {
  storeId: string;
  customerId: string;
  points: number;
  source?: string | null;
  description?: string | null;
}): Promise<void> {
  if (params.points <= 0) return;
  await trackLoyaltyActivity({
    storeId: params.storeId,
    customerId: params.customerId,
    metricName: KLAVIYO_METRICS.pointsEarned,
    eventProperties: {
      points: params.points,
      source: params.source ?? null,
      description: params.description ?? null,
    },
  });
}

/** Queue + push when customer redeems points. */
export async function notifyPointsRedeemed(params: {
  storeId: string;
  customerId: string;
  points: number;
  description?: string | null;
}): Promise<void> {
  if (params.points >= 0) return;
  await trackLoyaltyActivity({
    storeId: params.storeId,
    customerId: params.customerId,
    metricName: KLAVIYO_METRICS.pointsRedeemed,
    eventProperties: {
      points: Math.abs(params.points),
      description: params.description ?? null,
    },
  });
}
