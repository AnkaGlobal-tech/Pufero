import { getSupabaseAdmin } from "./supabase.server";
import { logKlaviyoEvent } from "./klaviyo-events.server";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function getCustomerBalance(
  storeId: string,
  customerId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("store_id", storeId)
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`expiry balance fetch failed: ${error.message}`);
  }
  return (data ?? []).reduce((sum, r) => sum + toNumber(r.points), 0);
}

async function expiryAlreadyLogged(
  storeId: string,
  sourceId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", storeId)
    .eq("source_id", sourceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`expiry ledger lookup failed: ${error.message}`);
  }
  return data != null;
}

async function reminderAlreadySent(
  storeId: string,
  customerId: string,
  eventName: string,
  expiryDateKey: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("klaviyo_events")
    .select("id")
    .eq("store_id", storeId)
    .eq("customer_id", customerId)
    .eq("event_name", eventName)
    .contains("payload", { expiry_date: expiryDateKey })
    .limit(1)
    .maybeSingle();

  if (error) {
    return false;
  }
  return data != null;
}

/**
 * Expire points X months after last activity + 30/7 day reminder events.
 * Light cron on dashboard load.
 */
export async function processPointsExpiry(storeId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("points_expiry_months")
    .eq("id", storeId)
    .single();

  if (storeError || !store?.points_expiry_months) {
    return 0;
  }

  const months = store.points_expiry_months as number;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, email, last_activity_at")
    .eq("store_id", storeId)
    .not("last_activity_at", "is", null)
    .limit(500);

  if (error) {
    throw new Error(`expiry customers fetch failed: ${error.message}`);
  }

  let actions = 0;

  for (const customer of customers ?? []) {
    const lastActivity = new Date(customer.last_activity_at as string);
    if (Number.isNaN(lastActivity.getTime())) {
      continue;
    }

    const expiryDate = addMonths(lastActivity, months);
    expiryDate.setUTCHours(0, 0, 0, 0);
    const expiryKey = toDateKey(expiryDate);
    const daysUntil = daysBetween(today, expiryDate);

    const balance = await getCustomerBalance(storeId, customer.id);
    if (balance <= 0) {
      continue;
    }

    if (daysUntil === 30) {
      const sent = await reminderAlreadySent(
        storeId,
        customer.id,
        "anka_points_expiring_30d",
        expiryKey,
      );
      if (!sent) {
        await logKlaviyoEvent({
          storeId,
          customerId: customer.id,
          eventName: "anka_points_expiring_30d",
          payload: {
            expiry_date: expiryKey,
            points_balance: balance,
            email: customer.email,
          },
        });
        actions += 1;
      }
    }

    if (daysUntil === 7) {
      const sent = await reminderAlreadySent(
        storeId,
        customer.id,
        "anka_points_expiring_7d",
        expiryKey,
      );
      if (!sent) {
        await logKlaviyoEvent({
          storeId,
          customerId: customer.id,
          eventName: "anka_points_expiring_7d",
          payload: {
            expiry_date: expiryKey,
            points_balance: balance,
            email: customer.email,
          },
        });
        actions += 1;
      }
    }

    if (daysUntil <= 0) {
      const sourceId = `expiry-${customer.id}-${expiryKey}`;
      if (await expiryAlreadyLogged(storeId, sourceId)) {
        continue;
      }

      const { error: insertError } = await supabase.from("points_ledger").insert({
        store_id: storeId,
        customer_id: customer.id,
        movement_type: "expired",
        points: -balance,
        source: "manual",
        source_id: sourceId,
        description: `Points expired (${months} months inactive)`,
        metadata: {
          expiry_date: expiryKey,
          expired_balance: balance,
        },
        created_by: "expiry-engine",
      });

      if (insertError) {
        console.error(`[expiry-engine] expire failed: ${insertError.message}`);
        continue;
      }

      await logKlaviyoEvent({
        storeId,
        customerId: customer.id,
        eventName: "anka_points_expired",
        payload: {
          expiry_date: expiryKey,
          points_expired: balance,
        },
      });

      console.log(
        `[expiry-engine] customer=${customer.id} -${balance} puan yandı`,
      );
      actions += 1;
    }
  }

  return actions;
}
