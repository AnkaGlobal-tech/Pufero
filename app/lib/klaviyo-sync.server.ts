import { getSupabaseAdmin } from "./supabase.server";
import { createKlaviyoEvent } from "./klaviyo-api.server";
import { loadKlaviyoSettings } from "./klaviyo-settings.server";
import { KLAVIYO_METRICS } from "./klaviyo-constants";

export { KLAVIYO_METRICS };

export interface LoyaltyProfileSnapshot {
  email: string;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  tierName: string | null;
  tierSlug: string | null;
  memberSince: string | null;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function mapLegacyEventName(eventName: string): string {
  switch (eventName) {
    case "anka_points_expiring_30d":
    case "anka_points_expiring_7d":
      return KLAVIYO_METRICS.pointsExpiring30d;
    case "anka_points_expired":
      return KLAVIYO_METRICS.pointsExpired;
    default:
      if (eventName.startsWith("Anka ")) return eventName;
      return eventName
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

export async function getLoyaltyProfileSnapshot(
  storeId: string,
  customerId: string,
): Promise<LoyaltyProfileSnapshot | null> {
  const supabase = getSupabaseAdmin();

  const { data: customer, error } = await supabase
    .from("customers")
    .select(
      "email, first_name, last_name, created_at, tiers(name, slug)",
    )
    .eq("store_id", storeId)
    .eq("id", customerId)
    .maybeSingle();

  if (error || !customer?.email) {
    return null;
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("store_id", storeId)
    .eq("customer_id", customerId);

  if (ledgerError) {
    throw new Error(`klaviyo balance fetch failed: ${ledgerError.message}`);
  }

  const balance = (ledgerRows ?? []).reduce(
    (sum, row) => sum + toNumber(row.points),
    0,
  );

  const tierRaw = (
    customer as { tiers: { name: string; slug: string } | { name: string; slug: string }[] | null }
  ).tiers;
  const tier = Array.isArray(tierRaw) ? tierRaw[0] ?? null : tierRaw;

  return {
    email: customer.email,
    firstName: customer.first_name ?? null,
    lastName: customer.last_name ?? null,
    balance,
    tierName: tier?.name ?? null,
    tierSlug: tier?.slug ?? null,
    memberSince: customer.created_at ?? null,
  };
}

export function buildKlaviyoProfileProperties(
  snapshot: LoyaltyProfileSnapshot,
): Record<string, unknown> {
  return {
    anka_points_balance: snapshot.balance,
    anka_tier: snapshot.tierName ?? "None",
    anka_tier_slug: snapshot.tierSlug ?? "",
    anka_loyalty_member: true,
    ...(snapshot.memberSince
      ? { anka_member_since: snapshot.memberSince }
      : {}),
  };
}

export async function pushKlaviyoEventForCustomer(params: {
  storeId: string;
  customerId: string;
  metricName: string;
  eventProperties?: Record<string, unknown>;
}): Promise<boolean> {
  const settings = await loadKlaviyoSettings(params.storeId);
  if (!settings?.apiKey) {
    return false;
  }

  const snapshot = await getLoyaltyProfileSnapshot(
    params.storeId,
    params.customerId,
  );
  if (!snapshot?.email) {
    return false;
  }

  await createKlaviyoEvent(settings.apiKey, {
    metricName: params.metricName,
    profile: {
      email: snapshot.email,
      firstName: snapshot.firstName,
      lastName: snapshot.lastName,
      properties: buildKlaviyoProfileProperties(snapshot),
    },
    properties: {
      anka_points_balance: snapshot.balance,
      anka_tier: snapshot.tierName,
      ...params.eventProperties,
    },
  });

  return true;
}

/** Sync one queued klaviyo_events row to Klaviyo API. */
export async function syncQueuedKlaviyoEvent(eventId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: row, error } = await supabase
    .from("klaviyo_events")
    .select("id, store_id, customer_id, event_name, payload, synced_at")
    .eq("id", eventId)
    .maybeSingle();

  if (error || !row || row.synced_at) {
    return false;
  }

  const settings = await loadKlaviyoSettings(row.store_id as string);
  if (!settings?.apiKey) {
    return false;
  }

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  let email = typeof payload.email === "string" ? payload.email : null;
  let snapshot: LoyaltyProfileSnapshot | null = null;

  if (row.customer_id) {
    snapshot = await getLoyaltyProfileSnapshot(
      row.store_id as string,
      row.customer_id as string,
    );
    email = snapshot?.email ?? email;
  }

  if (!email) {
    await supabase
      .from("klaviyo_events")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", row.id);
    return false;
  }

  const metricName = mapLegacyEventName(row.event_name as string);
  const profileProps = snapshot
    ? buildKlaviyoProfileProperties(snapshot)
    : {
        anka_points_balance: toNumber(payload.points_balance),
        anka_loyalty_member: true,
      };

  await createKlaviyoEvent(settings.apiKey, {
    metricName,
    profile: {
      email,
      firstName: snapshot?.firstName ?? null,
      lastName: snapshot?.lastName ?? null,
      properties: profileProps,
    },
    properties: payload,
  });

  await supabase
    .from("klaviyo_events")
    .update({ synced_at: new Date().toISOString() })
    .eq("id", row.id);

  return true;
}

/** Flush pending klaviyo_events for a store (newest first). */
export async function flushPendingKlaviyoEvents(
  storeId: string,
  limit = 50,
): Promise<{ synced: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const settings = await loadKlaviyoSettings(storeId);
  if (!settings?.apiKey) {
    return { synced: 0, failed: 0 };
  }

  const { data: rows, error } = await supabase
    .from("klaviyo_events")
    .select("id")
    .eq("store_id", storeId)
    .is("synced_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`klaviyo pending fetch failed: ${error.message}`);
  }

  let synced = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      const ok = await syncQueuedKlaviyoEvent(row.id as string);
      if (ok) synced += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[klaviyo-sync] event=${row.id} failed:`, err);
    }
  }

  return { synced, failed };
}

export async function countPendingKlaviyoEvents(
  storeId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("klaviyo_events")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .is("synced_at", null);

  if (error) {
    throw new Error(`klaviyo pending count failed: ${error.message}`);
  }
  return count ?? 0;
}

/** Track activity: queue + immediate push when Klaviyo is connected. */
export async function trackLoyaltyActivity(params: {
  storeId: string;
  customerId: string;
  metricName: string;
  eventProperties?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const snapshot = await getLoyaltyProfileSnapshot(
    params.storeId,
    params.customerId,
  );

  const { data: inserted, error } = await supabase
    .from("klaviyo_events")
    .insert({
      store_id: params.storeId,
      customer_id: params.customerId,
      event_name: params.metricName,
      payload: {
        email: snapshot?.email ?? null,
        ...params.eventProperties,
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[klaviyo] queue failed: ${error.message}`);
    return;
  }

  if (inserted?.id) {
    try {
      await syncQueuedKlaviyoEvent(inserted.id as string);
    } catch (err) {
      console.error(`[klaviyo] immediate sync failed:`, err);
    }
  }
}
