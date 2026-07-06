import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

import type { StoreRecord } from "./store.server";
import { getSupabaseAdmin } from "./supabase.server";
import { awardOrderPoints } from "./orders.server";
import { loadKlaviyoSettings, saveKlaviyoSettings } from "./klaviyo-settings.server";
import { KLAVIYO_METRICS } from "./klaviyo-constants";
import { pushKlaviyoEventForCustomer } from "./klaviyo-sync.server";

const BACKFILL_DAYS = 60;
const ORDERS_PAGE_SIZE = 50;

const ORDERS_BACKFILL_QUERY = `#graphql
  query OrdersBackfill($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: false, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          legacyResourceId
          cancelledAt
        }
      }
    }
  }
`;

export interface BackfillOrdersResult {
  scanned: number;
  awarded: number;
  skipped: number;
  errors: string[];
}

/** Award points for paid orders in the last N days (idempotent). */
export async function backfillRecentOrders(params: {
  admin: AdminApiContext;
  store: StoreRecord;
  days?: number;
}): Promise<BackfillOrdersResult> {
  const days = params.days ?? BACKFILL_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = `created_at:>=${since.toISOString().slice(0, 10)} financial_status:paid`;

  let after: string | null = null;
  let hasNextPage = true;
  const result: BackfillOrdersResult = {
    scanned: 0,
    awarded: 0,
    skipped: 0,
    errors: [],
  };

  while (hasNextPage) {
    const response = await params.admin.graphql(ORDERS_BACKFILL_QUERY, {
      variables: {
        first: ORDERS_PAGE_SIZE,
        query,
        after,
      },
    });

    const json = (await response.json()) as {
      data?: {
        orders?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          edges?: Array<{ node: { legacyResourceId?: string; cancelledAt?: string | null } }>;
        };
      };
      errors?: unknown[];
    };

    if (json.errors?.length) {
      throw new Error(`Shopify orders backfill failed: ${JSON.stringify(json.errors)}`);
    }

    const connection = json.data?.orders;
    const edges = connection?.edges ?? [];

    for (const edge of edges) {
      const orderId = Number(edge.node.legacyResourceId);
      if (!Number.isFinite(orderId)) continue;

      result.scanned += 1;

      if (edge.node.cancelledAt) {
        result.skipped += 1;
        continue;
      }

      const award = await awardOrderPoints({
        admin: params.admin,
        store: params.store,
        orderId,
      });

      if (award.ok) {
        if (award.points > 0) result.awarded += 1;
        else result.skipped += 1;
      } else {
        if (
          award.error.includes("Guest checkout") ||
          award.error.includes("already") ||
          award.error.includes("zaten")
        ) {
          result.skipped += 1;
        } else {
          result.errors.push(`Order #${orderId}: ${award.error}`);
        }
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
    if (!hasNextPage) break;
  }

  const settings = await loadKlaviyoSettings(params.store.id);
  if (settings) {
    await saveKlaviyoSettings(params.store.id, {
      ...settings,
      backfillCompletedAt: new Date().toISOString(),
    });
  }

  return result;
}

export interface WelcomeCampaignResult {
  targeted: number;
  sent: number;
  skipped: number;
  errors: string[];
}

/** Fire welcome metric for members active in the last N days. */
export async function sendWelcomeCampaign(params: {
  storeId: string;
  days?: number;
}): Promise<WelcomeCampaignResult> {
  const days = params.days ?? BACKFILL_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdmin();

  const settings = await loadKlaviyoSettings(params.storeId);
  if (!settings?.apiKey) {
    throw new Error("Connect Klaviyo before sending welcome emails.");
  }

  const { data: ruleRows } = await supabase
    .from("rules")
    .select("rule_type, points_value, enabled")
    .eq("store_id", params.storeId)
    .in("rule_type", ["review_text", "review_photo", "referral"]);

  const earningHints = (ruleRows ?? [])
    .filter((r) => r.enabled)
    .map((r) => ({
      type: r.rule_type,
      points: r.points_value,
    }));

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, email, last_activity_at, created_at")
    .eq("store_id", params.storeId)
    .not("email", "is", null)
    .or(`last_activity_at.gte.${since},created_at.gte.${since}`)
    .limit(2000);

  if (error) {
    throw new Error(`welcome customer fetch failed: ${error.message}`);
  }

  const result: WelcomeCampaignResult = {
    targeted: customers?.length ?? 0,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  for (const customer of customers ?? []) {
    if (!customer.email) {
      result.skipped += 1;
      continue;
    }

    try {
      const ok = await pushKlaviyoEventForCustomer({
        storeId: params.storeId,
        customerId: customer.id as string,
        metricName: KLAVIYO_METRICS.welcome,
        eventProperties: {
          welcome_window_days: days,
          review_text_points:
            earningHints.find((h) => h.type === "review_text")?.points ?? 0,
          review_photo_points:
            earningHints.find((h) => h.type === "review_photo")?.points ?? 0,
          referral_points:
            earningHints.find((h) => h.type === "referral")?.points ?? 0,
        },
      });
      if (ok) result.sent += 1;
      else result.skipped += 1;
    } catch (err) {
      result.errors.push(
        `${customer.email}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  await saveKlaviyoSettings(params.storeId, {
    ...settings,
    welcomeSentAt: new Date().toISOString(),
  });

  return result;
}

export async function getRecentMemberStats(
  storeId: string,
  days = BACKFILL_DAYS,
): Promise<{ memberCount: number; withEmail: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("customers")
    .select("id, email")
    .eq("store_id", storeId)
    .or(`last_activity_at.gte.${since},created_at.gte.${since}`);

  if (error) {
    throw new Error(`recent member stats failed: ${error.message}`);
  }

  const rows = data ?? [];
  return {
    memberCount: rows.length,
    withEmail: rows.filter((r) => r.email).length,
  };
}
