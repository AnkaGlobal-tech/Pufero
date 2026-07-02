import { unauthenticated } from "../shopify.server";
import type { OrderLineItem } from "./exclusions.server";

const DRAFT_LINE_ITEMS_QUERY = `#graphql
  query DraftOrderLineItems($id: ID!) {
    draftOrder(id: $id) {
      lineItems(first: 50) {
        nodes {
          product {
            legacyResourceId
          }
          originalTotalSet {
            shopMoney { amount }
          }
          discountedTotalSet {
            shopMoney { amount }
          }
          quantity
        }
      }
    }
  }
`;

const ORDER_LINE_ITEMS_QUERY = `#graphql
  query OrderLineItems($id: ID!) {
    order(id: $id) {
      lineItems(first: 50) {
        nodes {
          product {
            legacyResourceId
          }
          originalTotalSet {
            shopMoney { amount }
          }
          discountedTotalSet {
            shopMoney { amount }
          }
          quantity
        }
      }
    }
  }
`;

function nodesToLineItems(
  nodes: Array<{
    product?: { legacyResourceId?: string } | null;
    originalTotalSet?: { shopMoney?: { amount?: string } };
    discountedTotalSet?: { shopMoney?: { amount?: string } };
    quantity?: number;
  }>,
): OrderLineItem[] {
  return nodes
    .map((node) => {
      const productId = node.product?.legacyResourceId
        ? Number(node.product.legacyResourceId)
        : null;
      const discounted = node.discountedTotalSet?.shopMoney?.amount;
      const original = node.originalTotalSet?.shopMoney?.amount;
      const qty = node.quantity ?? 1;
      return {
        product_id: productId,
        quantity: qty,
        pre_tax_price: discounted ?? original ?? null,
        price: original ?? null,
      } satisfies OrderLineItem;
    })
    .filter((li) => li.product_id != null || li.pre_tax_price != null || li.price);
}

/** Extract line items from webhook payload (REST snake_case). */
export function lineItemsFromPayload(
  payload: Record<string, unknown>,
): OrderLineItem[] {
  const raw = payload.line_items as Array<Record<string, unknown>> | undefined;
  if (!raw?.length) {
    return [];
  }

  return raw.map((li) => ({
    product_id: li.product_id != null ? Number(li.product_id) : null,
    quantity: li.quantity != null ? Number(li.quantity) : 1,
    price: li.price != null ? String(li.price) : null,
    total_discount:
      li.total_discount != null ? String(li.total_discount) : null,
    pre_tax_price:
      li.pre_tax_price != null ? String(li.pre_tax_price) : null,
  }));
}

function hasProductIds(items: OrderLineItem[]): boolean {
  return items.some((li) => li.product_id != null && li.product_id > 0);
}

export async function fetchDraftOrderLineItems(
  shopDomain: string,
  draftId: number,
): Promise<OrderLineItem[]> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(DRAFT_LINE_ITEMS_QUERY, {
      variables: { id: `gid://shopify/DraftOrder/${draftId}` },
    });
    const json = await response.json();
    const nodes = json.data?.draftOrder?.lineItems?.nodes ?? [];
    return nodesToLineItems(nodes);
  } catch (error) {
    console.error(`[order-line-items] draft=${draftId} fetch failed:`, error);
    return [];
  }
}

export async function fetchOrderLineItems(
  shopDomain: string,
  orderId: number,
): Promise<OrderLineItem[]> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(ORDER_LINE_ITEMS_QUERY, {
      variables: { id: `gid://shopify/Order/${orderId}` },
    });
    const json = await response.json();
    const nodes = json.data?.order?.lineItems?.nodes ?? [];
    return nodesToLineItems(nodes);
  } catch (error) {
    console.error(`[order-line-items] order=${orderId} fetch failed:`, error);
    return [];
  }
}

/** Draft ID linked to a completed order, if any. */
export async function resolveDraftIdForOrder(
  shopDomain: string,
  orderId: number,
): Promise<number | null> {
  const QUERY = `#graphql
    query DraftForOrder($first: Int!) {
      draftOrders(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          legacyResourceId
          order {
            legacyResourceId
          }
        }
      }
    }
  `;

  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(QUERY, { variables: { first: 50 } });
    const json = await response.json();
    const nodes = json.data?.draftOrders?.nodes ?? [];

    for (const node of nodes) {
      const linkedOrderId = node.order?.legacyResourceId
        ? Number(node.order.legacyResourceId)
        : null;
      if (linkedOrderId === orderId) {
        const draftId = Number(node.legacyResourceId);
        return Number.isFinite(draftId) ? draftId : null;
      }
    }
  } catch (error) {
    console.error(`[order-line-items] draft lookup for order=${orderId} failed:`, error);
  }

  return null;
}

/** Fill missing line items from Shopify Admin when absent in webhook. */
export async function resolveLineItemsForEarn(params: {
  shopDomain: string;
  payload: Record<string, unknown>;
  orderId?: number;
  draftId?: number;
}): Promise<OrderLineItem[]> {
  let items = lineItemsFromPayload(params.payload);

  if (!hasProductIds(items) && params.draftId) {
    const fetched = await fetchDraftOrderLineItems(
      params.shopDomain,
      params.draftId,
    );
    if (fetched.length > 0) {
      items = fetched;
    }
  }

  if (!hasProductIds(items) && params.orderId) {
    const fetched = await fetchOrderLineItems(
      params.shopDomain,
      params.orderId,
    );
    if (fetched.length > 0) {
      items = fetched;
    }
  }

  return items;
}
