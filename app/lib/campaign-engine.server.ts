import { unauthenticated } from "../shopify.server";
import { getSupabaseAdmin } from "./supabase.server";
import type { OrderLineItem } from "./exclusions.server";
import {
  getStoreExclusions,
  loadProductCollectionMap,
  isProductExcluded,
  lineItemSubtotal,
} from "./exclusions.server";

interface ActiveCampaign {
  id: string;
  name: string;
  multiplier: number;
  collection_ids: number[];
}

const PRODUCT_IN_COLLECTION_QUERY = `#graphql
  query ProductInCollection($productId: ID!, $collectionId: ID!) {
    product(id: $productId) {
      inCollection(id: $collectionId)
    }
  }
`;

function toNumber(value: unknown): number {
  if (value == null) return 1;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function loadActiveCampaigns(storeId: string): Promise<ActiveCampaign[]> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, multiplier, collection_ids")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .order("multiplier", { ascending: false });

  if (error) {
    throw new Error(`campaigns fetch failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    multiplier: toNumber(row.multiplier),
    collection_ids: ((row.collection_ids as number[]) ?? []).map(Number),
  }));
}

export interface CampaignMultiplierResult {
  multiplier: number;
  campaignId: string | null;
  campaignName: string | null;
  /** Amount the campaign multiplier applies to (collection line items). */
  campaignEligibleAmount: number;
}

async function productInAnyCampaignCollection(params: {
  shopDomain: string;
  productId: number;
  collectionIds: number[];
}): Promise<boolean> {
  if (params.collectionIds.length === 0) {
    return true;
  }

  try {
    const { admin } = await unauthenticated.admin(params.shopDomain);
    const productGid = `gid://shopify/Product/${params.productId}`;

    for (const collectionId of params.collectionIds) {
      const response = await admin.graphql(PRODUCT_IN_COLLECTION_QUERY, {
        variables: {
          productId: productGid,
          collectionId: `gid://shopify/Collection/${collectionId}`,
        },
      });
      const json = await response.json();
      if (json.data?.product?.inCollection === true) {
        return true;
      }
    }
  } catch (error) {
    console.error(
      `[campaign-engine] inCollection check failed product=${params.productId}:`,
      error,
    );
  }

  return false;
}

async function computeCampaignEligibleAmount(params: {
  storeId: string;
  shopDomain: string;
  lineItems: OrderLineItem[];
  totalEligibleAmount: number;
  campaign: ActiveCampaign;
}): Promise<number> {
  if (params.campaign.collection_ids.length === 0) {
    return params.totalEligibleAmount;
  }

  if (params.lineItems.length === 0) {
    return 0;
  }

  const exclusions = await getStoreExclusions(params.storeId);
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

  let amount = 0;

  for (const li of params.lineItems) {
    const pid = li.product_id;
    if (!pid) continue;
    if (isProductExcluded(pid, exclusions, productCollections)) {
      continue;
    }

    const inCollection = await productInAnyCampaignCollection({
      shopDomain: params.shopDomain,
      productId: pid,
      collectionIds: params.campaign.collection_ids,
    });

    if (inCollection) {
      amount += lineItemSubtotal(li);
    }
  }

  return amount;
}

/**
 * Returns highest applicable active campaign multiplier and eligible amount.
 */
export async function getCampaignMultiplier(params: {
  storeId: string;
  shopDomain: string;
  lineItems: OrderLineItem[];
  totalEligibleAmount: number;
}): Promise<CampaignMultiplierResult> {
  const campaigns = await loadActiveCampaigns(params.storeId);
  if (campaigns.length === 0) {
    return {
      multiplier: 1,
      campaignId: null,
      campaignName: null,
      campaignEligibleAmount: 0,
    };
  }

  for (const campaign of campaigns) {
    const campaignEligibleAmount = await computeCampaignEligibleAmount({
      storeId: params.storeId,
      shopDomain: params.shopDomain,
      lineItems: params.lineItems,
      totalEligibleAmount: params.totalEligibleAmount,
      campaign,
    });

    if (campaignEligibleAmount > 0) {
      return {
        multiplier: campaign.multiplier,
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignEligibleAmount,
      };
    }
  }

  return {
    multiplier: 1,
    campaignId: null,
    campaignName: null,
    campaignEligibleAmount: 0,
  };
}

export interface CampaignRow {
  id: string;
  name: string;
  multiplier: number;
  starts_at: string;
  ends_at: string;
  collection_ids: number[];
  is_active: boolean;
}

export async function listCampaigns(storeId: string): Promise<CampaignRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, multiplier, starts_at, ends_at, collection_ids, is_active")
    .eq("store_id", storeId)
    .order("starts_at", { ascending: false });

  if (error) {
    throw new Error(`campaigns list failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    multiplier: toNumber(row.multiplier),
    starts_at: row.starts_at as string,
    ends_at: row.ends_at as string,
    collection_ids: ((row.collection_ids as number[]) ?? []).map(Number),
    is_active: Boolean(row.is_active),
  }));
}

export async function createCampaign(
  storeId: string,
  form: FormData,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const name = String(form.get("campaign_name") ?? "").trim();
  const multiplier = Math.max(1, toNumber(form.get("campaign_multiplier"), 1));
  const startsAt = String(form.get("campaign_starts_at") ?? "");
  const endsAt = String(form.get("campaign_ends_at") ?? "");
  const collectionRaw = String(form.get("campaign_collection_ids") ?? "");
  const collectionIds = collectionRaw
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!name || !startsAt || !endsAt) {
    throw new Error("Campaign name and date range are required.");
  }

  const { error } = await supabase.from("campaigns").insert({
    store_id: storeId,
    name,
    multiplier,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    collection_ids: collectionIds,
    is_active: form.get("campaign_is_active") === "on",
  });

  if (error) {
    throw new Error(`campaign create failed: ${error.message}`);
  }
}

export async function toggleCampaign(
  storeId: string,
  campaignId: string,
  isActive: boolean,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("campaigns")
    .update({ is_active: isActive })
    .eq("id", campaignId)
    .eq("store_id", storeId);

  if (error) {
    throw new Error(`campaign toggle failed: ${error.message}`);
  }
}

export async function deleteCampaign(
  storeId: string,
  campaignId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("store_id", storeId);

  if (error) {
    throw new Error(`campaign delete failed: ${error.message}`);
  }
}

export interface ExclusionRow {
  id: string;
  resource_type: "product" | "collection";
  shopify_resource_id: number;
}

export async function listExclusions(storeId: string): Promise<ExclusionRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exclusions")
    .select("id, resource_type, shopify_resource_id")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`exclusions list failed: ${error.message}`);
  }

  return (data as ExclusionRow[]) ?? [];
}

export async function addExclusion(
  storeId: string,
  form: FormData,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const resourceType = String(form.get("exclusion_type") ?? "product");
  const resourceId = parseInt(String(form.get("exclusion_resource_id") ?? ""), 10);

  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error("Enter a valid Shopify resource ID.");
  }

  if (resourceType !== "product" && resourceType !== "collection") {
    throw new Error("Resource type must be product or collection.");
  }

  const { error } = await supabase.from("exclusions").insert({
    store_id: storeId,
    resource_type: resourceType,
    shopify_resource_id: resourceId,
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("This resource is already on the exclusion list.");
    }
    throw new Error(`exclusion add failed: ${error.message}`);
  }
}

export async function deleteExclusion(
  storeId: string,
  exclusionId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("exclusions")
    .delete()
    .eq("id", exclusionId)
    .eq("store_id", storeId);

  if (error) {
    throw new Error(`exclusion delete failed: ${error.message}`);
  }
}
