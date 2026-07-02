import { unauthenticated } from "../shopify.server";
import { getSupabaseAdmin } from "./supabase.server";

export interface OrderLineItem {
  product_id?: number | null;
  quantity?: number;
  price?: string | null;
  total_discount?: string | null;
  pre_tax_price?: string | null;
}

interface StoreExclusions {
  productIds: Set<number>;
  collectionIds: Set<number>;
}

const PRODUCT_COLLECTIONS_QUERY = `#graphql
  query ProductCollections($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        legacyResourceId
        collections(first: 30) {
          nodes {
            legacyResourceId
          }
        }
      }
    }
  }
`;

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function lineItemSubtotal(item: OrderLineItem): number {
  if (item.pre_tax_price != null) {
    return toNumber(item.pre_tax_price);
  }
  const qty = item.quantity ?? 1;
  const lineTotal = toNumber(item.price) * qty;
  return Math.max(0, lineTotal - toNumber(item.total_discount));
}

export async function getStoreExclusions(
  storeId: string,
): Promise<StoreExclusions> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exclusions")
    .select("resource_type, shopify_resource_id")
    .eq("store_id", storeId);

  if (error) {
    throw new Error(`exclusions fetch failed: ${error.message}`);
  }

  const productIds = new Set<number>();
  const collectionIds = new Set<number>();

  for (const row of data ?? []) {
    const id = Number(row.shopify_resource_id);
    if (!Number.isFinite(id)) continue;
    if (row.resource_type === "product") {
      productIds.add(id);
    } else {
      collectionIds.add(id);
    }
  }

  return { productIds, collectionIds };
}

export async function loadProductCollectionMap(
  shopDomain: string,
  productIds: number[],
): Promise<Map<number, Set<number>>> {
  const map = new Map<number, Set<number>>();
  if (productIds.length === 0) {
    return map;
  }

  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const gids = productIds.map((id) => `gid://shopify/Product/${id}`);
    const response = await admin.graphql(PRODUCT_COLLECTIONS_QUERY, {
      variables: { ids: gids },
    });
    const json = await response.json();

    for (const node of json.data?.nodes ?? []) {
      if (!node?.legacyResourceId) continue;
      const pid = Number(node.legacyResourceId);
      const cols = new Set<number>(
        (node.collections?.nodes ?? []).map((c: { legacyResourceId: string }) =>
          Number(c.legacyResourceId),
        ),
      );
      map.set(pid, cols);
    }
  } catch (error) {
    console.error("[exclusions] product collections fetch failed:", error);
  }

  return map;
}

export function isProductExcluded(
  productId: number,
  exclusions: StoreExclusions,
  productCollections: Map<number, Set<number>>,
): boolean {
  if (exclusions.productIds.has(productId)) {
    return true;
  }
  const cols = productCollections.get(productId);
  if (!cols) {
    return false;
  }
  for (const cid of exclusions.collectionIds) {
    if (cols.has(cid)) {
      return true;
    }
  }
  return false;
}

/** Points base after excluding products/collections. */
export async function computeEligibleSubtotal(params: {
  storeId: string;
  shopDomain: string;
  lineItems: OrderLineItem[];
  fallbackSubtotal: number;
}): Promise<{ eligibleAmount: number; excludedAmount: number }> {
  if (params.lineItems.length === 0) {
    return {
      eligibleAmount: params.fallbackSubtotal,
      excludedAmount: 0,
    };
  }

  const exclusions = await getStoreExclusions(params.storeId);
  if (
    exclusions.productIds.size === 0 &&
    exclusions.collectionIds.size === 0
  ) {
    const total = params.lineItems.reduce(
      (sum, li) => sum + lineItemSubtotal(li),
      0,
    );
    return {
      eligibleAmount: total > 0 ? total : params.fallbackSubtotal,
      excludedAmount: 0,
    };
  }

  const productIds = [
    ...new Set(
      params.lineItems
        .map((li) => li.product_id)
        .filter((id): id is number => id != null && id > 0),
    ),
  ];

  const productCollections =
    exclusions.collectionIds.size > 0
      ? await loadProductCollectionMap(params.shopDomain, productIds)
      : new Map<number, Set<number>>();

  let eligible = 0;
  let excluded = 0;

  for (const li of params.lineItems) {
    const subtotal = lineItemSubtotal(li);
    const pid = li.product_id;
    if (pid && isProductExcluded(pid, exclusions, productCollections)) {
      excluded += subtotal;
      continue;
    }
    eligible += subtotal;
  }

  if (eligible <= 0 && params.fallbackSubtotal > 0) {
    return {
      eligibleAmount: Math.max(0, params.fallbackSubtotal - excluded),
      excludedAmount: excluded,
    };
  }

  return { eligibleAmount: eligible, excludedAmount: excluded };
}

/** Campaign collection filter: does at least one eligible line match? */
export async function orderMatchesCampaignCollections(params: {
  shopDomain: string;
  lineItems: OrderLineItem[];
  campaignCollectionIds: number[];
  storeId: string;
}): Promise<boolean> {
  if (params.campaignCollectionIds.length === 0) {
    return true;
  }

  const exclusions = await getStoreExclusions(params.storeId);
  const productIds = [
    ...new Set(
      params.lineItems
        .map((li) => li.product_id)
        .filter((id): id is number => id != null && id > 0),
    ),
  ];

  const productCollections = await loadProductCollectionMap(
    params.shopDomain,
    productIds,
  );

  const campaignSet = new Set(params.campaignCollectionIds);

  for (const li of params.lineItems) {
    const pid = li.product_id;
    if (!pid) continue;
    if (
      isProductExcluded(pid, exclusions, productCollections)
    ) {
      continue;
    }
    const cols = productCollections.get(pid);
    if (!cols) continue;
    for (const cid of cols) {
      if (campaignSet.has(cid)) {
        return true;
      }
    }
  }

  return false;
}
