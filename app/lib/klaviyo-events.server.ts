import { getSupabaseAdmin } from "./supabase.server";

/** Event queue before Klaviyo integration is enabled. */
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
