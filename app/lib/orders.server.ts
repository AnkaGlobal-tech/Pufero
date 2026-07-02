import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

import { getSupabaseAdmin } from "./supabase.server";
import type { StoreRecord } from "./store.server";
import {
  earnOrderPoints,
  earnDraftOrderPoints,
  draftOrderSourceId,
} from "./points-engine.server";

export type OrderPointsStatus =
  | "awarded"
  | "pending"
  | "guest"
  | "cancelled";

export interface OrderRow {
  id: number;
  name: string;
  createdAt: string;
  subtotal: number;
  customerName: string | null;
  customerEmail: string | null;
  hasCustomer: boolean;
  cancelled: boolean;
  pointsStatus: OrderPointsStatus;
  pointsAwarded: number | null;
  estimatedPoints: number;
}

export interface DraftOrderRow {
  id: number;
  name: string;
  updatedAt: string;
  subtotal: number;
  status: string;
  customerEmail: string | null;
  customerName: string | null;
  hasCustomer: boolean;
  customerShopifyId: number | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  pointsStatus: OrderPointsStatus;
  pointsAwarded: number | null;
  estimatedPoints: number;
}

export interface StorePointsSummary {
  pointsPerDollar: number;
  pointsToDollarRatio: number;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getStorePointsSummary(
  storeId: string,
): Promise<StorePointsSummary> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("points_per_dollar, points_to_dollar_ratio")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    throw new Error(`store points fetch failed: ${error?.message ?? "no row"}`);
  }

  return {
    pointsPerDollar: toNumber(data.points_per_dollar),
    pointsToDollarRatio: toNumber(data.points_to_dollar_ratio),
  };
}

async function getAwardedPointsByOrderId(
  storeId: string,
  orderIds: number[],
): Promise<Map<number, number>> {
  if (orderIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("shopify_order_id, points")
    .eq("store_id", storeId)
    .eq("movement_type", "earn")
    .in("shopify_order_id", orderIds);

  if (error) {
    throw new Error(`ledger order lookup failed: ${error.message}`);
  }

  const map = new Map<number, number>();
  for (const row of data ?? []) {
    const orderId = row.shopify_order_id as number | null;
    if (orderId != null) {
      map.set(orderId, toNumber(row.points));
    }
  }
  return map;
}

async function getAwardedPointsByDraftIds(
  storeId: string,
  draftIds: number[],
): Promise<Map<number, number>> {
  if (draftIds.length === 0) {
    return new Map();
  }

  const sourceIds = draftIds.map((id) => draftOrderSourceId(id));
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("source_id, points")
    .eq("store_id", storeId)
    .eq("movement_type", "earn")
    .in("source_id", sourceIds);

  if (error) {
    throw new Error(`ledger draft lookup failed: ${error.message}`);
  }

  const map = new Map<number, number>();
  for (const row of data ?? []) {
    const sourceId = row.source_id as string;
    const draftId = Number(sourceId.replace(/^draft-/, ""));
    if (Number.isFinite(draftId)) {
      map.set(draftId, toNumber(row.points));
    }
  }
  return map;
}

const ORDERS_QUERY = `#graphql
  query RecentOrders($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          legacyResourceId
          name
          createdAt
          cancelledAt
          subtotalPriceSet {
            shopMoney {
              amount
            }
          }
          customer {
            legacyResourceId
            email
            firstName
            lastName
          }
        }
      }
    }
  }
`;

const DRAFT_ORDERS_QUERY = `#graphql
  query RecentDraftOrders($first: Int!) {
    draftOrders(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          legacyResourceId
          name
          status
          updatedAt
          email
          subtotalPriceSet {
            shopMoney {
              amount
            }
          }
          customer {
            legacyResourceId
            email
            firstName
            lastName
          }
        }
      }
    }
  }
`;

const ORDER_FOR_AWARD_QUERY = `#graphql
  query OrderForAward($id: ID!) {
    order(id: $id) {
      legacyResourceId
      cancelledAt
      subtotalPriceSet {
        shopMoney {
          amount
        }
      }
      customer {
        legacyResourceId
        email
        firstName
        lastName
      }
    }
  }
`;

export async function fetchRecentOrders(params: {
  admin: AdminApiContext;
  storeId: string;
  limit?: number;
}): Promise<{ orders: OrderRow[]; points: StorePointsSummary }> {
  const limit = params.limit ?? 25;
  const [response, points] = await Promise.all([
    params.admin.graphql(ORDERS_QUERY, { variables: { first: limit } }),
    getStorePointsSummary(params.storeId),
  ]);

  const json = (await response.json()) as {
    data?: { orders?: { edges?: Array<{ node: Record<string, unknown> }> } };
    errors?: unknown[];
  };

  if (json.errors?.length) {
    console.error("[orders] orders query failed:", json.errors);
    throw new Error("Could not fetch Shopify order list.");
  }

  const edges = json.data?.orders?.edges ?? [];

  const orderIds = edges
    .map((e) => Number(e.node.legacyResourceId))
    .filter((id) => Number.isFinite(id));

  const awarded = await getAwardedPointsByOrderId(params.storeId, orderIds);

  const orders: OrderRow[] = edges.map(({ node }) => {
    const id = Number(node.legacyResourceId);
    const subtotal = toNumber(
      (node.subtotalPriceSet as { shopMoney?: { amount?: string } })
        ?.shopMoney?.amount,
    );
    const customer = node.customer as {
      legacyResourceId?: string;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    } | null;
    const cancelled = node.cancelledAt != null;
    const hasCustomer = Boolean(customer?.legacyResourceId);
    const estimatedPoints = Math.floor(subtotal * points.pointsPerDollar);
    const pointsAwarded = awarded.get(id) ?? null;

    let pointsStatus: OrderPointsStatus;
    if (cancelled) {
      pointsStatus = "cancelled";
    } else if (!hasCustomer) {
      pointsStatus = "guest";
    } else if (pointsAwarded != null && pointsAwarded > 0) {
      pointsStatus = "awarded";
    } else if (pointsAwarded === 0 && awarded.has(id)) {
      pointsStatus = "awarded";
    } else {
      pointsStatus = "pending";
    }

    const customerName = customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
        null
      : null;

    return {
      id,
      name: String(node.name ?? `#${id}`),
      createdAt: String(node.createdAt ?? ""),
      subtotal,
      customerName,
      customerEmail: customer?.email ?? null,
      hasCustomer,
      cancelled,
      pointsStatus,
      pointsAwarded,
      estimatedPoints,
    };
  });

  return { orders, points };
}

export async function fetchDraftOrders(params: {
  admin: AdminApiContext;
  storeId: string;
  limit?: number;
}): Promise<DraftOrderRow[]> {
  const limit = params.limit ?? 15;
  const points = await getStorePointsSummary(params.storeId);

  try {
    const response = await params.admin.graphql(DRAFT_ORDERS_QUERY, {
      variables: { first: limit },
    });
    const json = (await response.json()) as {
      data?: { draftOrders?: { edges?: Array<{ node: Record<string, unknown> }> } };
      errors?: unknown[];
    };

    if (json.errors?.length) {
      console.error("[orders] draftOrders query failed:", json.errors);
      return [];
    }

    const edges = json.data?.draftOrders?.edges ?? [];
    const draftIds = edges
      .map((e) => Number(e.node.legacyResourceId))
      .filter((id) => Number.isFinite(id));
    const awarded = await getAwardedPointsByDraftIds(params.storeId, draftIds);

    return edges.map(({ node }) => {
      const id = Number(node.legacyResourceId);
      const subtotal = toNumber(
        (node.subtotalPriceSet as { shopMoney?: { amount?: string } })
          ?.shopMoney?.amount,
      );
      const customer = node.customer as {
        legacyResourceId?: string;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      } | null;
      const hasCustomer = Boolean(customer?.legacyResourceId);
      const status = String(node.status ?? "OPEN");
      const estimatedPoints = Math.floor(subtotal * points.pointsPerDollar);
      const pointsAwarded = awarded.get(id) ?? null;

      let pointsStatus: OrderPointsStatus;
      if (status === "COMPLETED") {
        pointsStatus = pointsAwarded != null ? "awarded" : "pending";
      } else if (!hasCustomer) {
        pointsStatus = "guest";
      } else if (pointsAwarded != null) {
        pointsStatus = "awarded";
      } else {
        pointsStatus = "pending";
      }

      const customerName = customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
          null
        : null;

      return {
        id,
        name: String(node.name ?? "Taslak"),
        updatedAt: String(node.updatedAt ?? ""),
        subtotal,
        status,
        customerEmail: customer?.email ?? (node.email as string | null) ?? null,
        customerName,
        hasCustomer,
        customerShopifyId: customer?.legacyResourceId
          ? Number(customer.legacyResourceId)
          : null,
        customerFirstName: customer?.firstName ?? null,
        customerLastName: customer?.lastName ?? null,
        pointsStatus,
        pointsAwarded,
        estimatedPoints,
      };
    });
  } catch (error) {
    console.warn("[orders] draftOrders fetch error:", error);
    return [];
  }
}

function draftToPayload(draft: DraftOrderRow): Record<string, unknown> {
  return {
    id: draft.id,
    subtotal_price: String(draft.subtotal),
    status: draft.status,
    customer: {
      id: draft.customerShopifyId,
      email: draft.customerEmail,
      first_name: draft.customerFirstName,
      last_name: draft.customerLastName,
    },
  };
}

/** Award points for missed draft orders (on Dashboard/Orders load). */
export async function syncPendingDraftOrders(params: {
  admin: AdminApiContext;
  store: StoreRecord;
  limit?: number;
}): Promise<number> {
  const drafts = await fetchDraftOrders({
    admin: params.admin,
    storeId: params.store.id,
    limit: params.limit ?? 25,
  });

  let awardedTotal = 0;
  for (const draft of drafts) {
    if (!draft.hasCustomer || !draft.customerShopifyId) {
      continue;
    }

    const points = await earnDraftOrderPoints({
      store: params.store,
      payload: draftToPayload(draft),
    });

    if (draft.status !== "COMPLETED" && draft.pointsStatus !== "awarded") {
      awardedTotal += points;
    }
  }

  return awardedTotal;
}

export async function awardDraftOrderPoints(params: {
  store: StoreRecord;
  draft: DraftOrderRow;
}): Promise<{ ok: true; points: number } | { ok: false; error: string }> {
  if (!params.draft.hasCustomer || !params.draft.customerShopifyId) {
    return { ok: false, error: "Cannot award points to a draft order without a selected customer." };
  }

  const points = await earnDraftOrderPoints({
    store: params.store,
    payload: draftToPayload(params.draft),
  });
  if (points === 0 && params.draft.pointsStatus === "awarded") {
    return { ok: true, points: params.draft.pointsAwarded ?? 0 };
  }
  if (points === 0) {
    return { ok: false, error: "Could not award points (program paused or zero amount)." };
  }

  return { ok: true, points };
}

/** Award points for a single order (missed webhook or historical). Idempotent. */
export async function awardOrderPoints(params: {
  admin: AdminApiContext;
  store: StoreRecord;
  orderId: number;
}): Promise<{ ok: true; points: number } | { ok: false; error: string }> {
  const gid = `gid://shopify/Order/${params.orderId}`;
  const response = await params.admin.graphql(ORDER_FOR_AWARD_QUERY, {
    variables: { id: gid },
  });
  const json = await response.json();
  const order = json.data?.order as Record<string, unknown> | null;

  if (!order) {
    return { ok: false, error: "Order not found in Shopify." };
  }

  if (order.cancelledAt) {
    return { ok: false, error: "Cannot award points to a cancelled order." };
  }

  const customer = order.customer as {
    legacyResourceId?: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;

  if (!customer?.legacyResourceId) {
    return {
      ok: false,
      error: "Guest checkout — cannot award points without a customer record.",
    };
  }

  const subtotal = toNumber(
    (order.subtotalPriceSet as { shopMoney?: { amount?: string } })?.shopMoney
      ?.amount,
  );
  const pointsConfig = await getStorePointsSummary(params.store.id);
  const estimated = Math.floor(subtotal * pointsConfig.pointsPerDollar);

  const payload: Record<string, unknown> = {
    id: params.orderId,
    subtotal_price: String(subtotal),
    current_subtotal_price: String(subtotal),
    customer: {
      id: Number(customer.legacyResourceId),
      email: customer.email ?? null,
      first_name: customer.firstName ?? null,
      last_name: customer.lastName ?? null,
    },
  };

  await earnOrderPoints({ store: params.store, payload });

  const awarded = await getAwardedPointsByOrderId(params.store.id, [
    params.orderId,
  ]);
  const points = awarded.get(params.orderId) ?? estimated;

  return { ok: true, points };
}
