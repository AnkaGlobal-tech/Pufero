import { getSupabaseAdmin } from "./supabase.server";
import type { EarningRuleType, RedemptionRewardType } from "../types/loyalty";
import { RULE_LABELS } from "./program-labels";
import {
  listCampaigns,
  createCampaign,
  toggleCampaign,
  deleteCampaign,
  listExclusions,
  addExclusion,
  deleteExclusion,
  type CampaignRow,
  type ExclusionRow,
} from "./campaign-engine.server";

export type { CampaignRow, ExclusionRow };

export interface StorePointsSettings {
  points_per_dollar: number;
  points_to_dollar_ratio: number;
  points_expiry_months: number | null;
  program_paused: boolean;
}

export interface RuleRow {
  id: string;
  rule_type: EarningRuleType;
  enabled: boolean;
  points_value: number;
  config: Record<string, unknown>;
}

export interface TierRow {
  id: string;
  slug: string;
  name: string;
  threshold_spend: number;
  discount_percent: number;
  points_multiplier: number;
  sort_order: number;
}

export interface RedemptionRow {
  id: string;
  name: string;
  points_cost: number;
  reward_type: RedemptionRewardType;
  reward_value: number | null;
  enabled: boolean;
  sort_order: number;
}

export interface ProgramData {
  store: StorePointsSettings;
  rules: RuleRow[];
  tiers: TierRow[];
  redemptions: RedemptionRow[];
  campaigns: CampaignRow[];
  exclusions: ExclusionRow[];
}

export async function getProgramData(storeId: string): Promise<ProgramData> {
  const supabase = getSupabaseAdmin();

  const [storeRes, rulesRes, tiersRes, redemptionsRes, campaigns, exclusions] =
    await Promise.all([
    supabase
      .from("stores")
      .select(
        "points_per_dollar, points_to_dollar_ratio, points_expiry_months, program_paused",
      )
      .eq("id", storeId)
      .single(),
    supabase
      .from("rules")
      .select("id, rule_type, enabled, points_value, config")
      .eq("store_id", storeId),
    supabase
      .from("tiers")
      .select(
        "id, slug, name, threshold_spend, discount_percent, points_multiplier, sort_order",
      )
      .eq("store_id", storeId)
      .order("sort_order"),
    supabase
      .from("redemptions")
      .select("id, name, points_cost, reward_type, reward_value, enabled, sort_order")
      .eq("store_id", storeId)
      .order("sort_order"),
    listCampaigns(storeId),
    listExclusions(storeId),
  ]);

  if (storeRes.error) throw new Error(`store fetch failed: ${storeRes.error.message}`);
  if (rulesRes.error) throw new Error(`rules fetch failed: ${rulesRes.error.message}`);
  if (tiersRes.error) throw new Error(`tiers fetch failed: ${tiersRes.error.message}`);
  if (redemptionsRes.error)
    throw new Error(`redemptions fetch failed: ${redemptionsRes.error.message}`);

  const ruleOrder = Object.keys(RULE_LABELS) as EarningRuleType[];
  const rules = ((rulesRes.data as RuleRow[]) ?? []).sort(
    (a, b) => ruleOrder.indexOf(a.rule_type) - ruleOrder.indexOf(b.rule_type),
  );

  return {
    store: storeRes.data as StorePointsSettings,
    rules,
    tiers: (tiersRes.data as TierRow[]) ?? [],
    redemptions: (redemptionsRes.data as RedemptionRow[]) ?? [],
    campaigns,
    exclusions,
  };
}

function toNumber(value: FormDataEntryValue | null, fallback = 0): number {
  if (value == null) return fallback;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

export async function updateStorePoints(
  storeId: string,
  form: FormData,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const expiryRaw = String(form.get("points_expiry_months") ?? "");
  const pointsExpiryMonths =
    expiryRaw === "" || expiryRaw === "off"
      ? null
      : parseInt(expiryRaw, 10);

  const { error } = await supabase
    .from("stores")
    .update({
      points_per_dollar: Math.max(0, toNumber(form.get("points_per_dollar"), 1)),
      points_to_dollar_ratio: Math.max(
        1,
        toNumber(form.get("points_to_dollar_ratio"), 100),
      ),
      points_expiry_months:
        pointsExpiryMonths != null &&
        [6, 12, 24].includes(pointsExpiryMonths)
          ? pointsExpiryMonths
          : null,
    })
    .eq("id", storeId);

  if (error) throw new Error(`store points update failed: ${error.message}`);
}

export {
  createCampaign,
  toggleCampaign,
  deleteCampaign,
  addExclusion,
  deleteExclusion,
};

export async function updateRules(storeId: string, form: FormData): Promise<void> {
  const supabase = getSupabaseAdmin();
  const ids = form.getAll("rule_id").map(String);

  await Promise.all(
    ids.map((id) => {
      const enabled = form.get(`rule_enabled_${id}`) === "on";
      const points = Math.max(0, Math.round(toNumber(form.get(`rule_points_${id}`))));
      return supabase
        .from("rules")
        .update({ enabled, points_value: points })
        .eq("id", id)
        .eq("store_id", storeId);
    }),
  );
}

export async function updateTiers(storeId: string, form: FormData): Promise<void> {
  const supabase = getSupabaseAdmin();
  const ids = form.getAll("tier_id").map(String);

  await Promise.all(
    ids.map((id) =>
      supabase
        .from("tiers")
        .update({
          threshold_spend: Math.max(0, toNumber(form.get(`tier_threshold_${id}`))),
          discount_percent: Math.max(0, toNumber(form.get(`tier_discount_${id}`))),
          points_multiplier: Math.max(
            0,
            toNumber(form.get(`tier_multiplier_${id}`), 1),
          ),
        })
        .eq("id", id)
        .eq("store_id", storeId),
    ),
  );
}

export async function updateRedemptions(
  storeId: string,
  form: FormData,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const ids = form.getAll("redemption_id").map(String);

  await Promise.all(
    ids.map((id) => {
      const enabled = form.get(`redemption_enabled_${id}`) === "on";
      const pointsCost = Math.max(
        1,
        Math.round(toNumber(form.get(`redemption_cost_${id}`), 1)),
      );
      const rewardValue = toNumber(form.get(`redemption_value_${id}`));
      return supabase
        .from("redemptions")
        .update({
          enabled,
          points_cost: pointsCost,
          reward_value: rewardValue,
        })
        .eq("id", id)
        .eq("store_id", storeId);
    }),
  );
}
