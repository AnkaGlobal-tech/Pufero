import type { EarningRuleType, RedemptionRewardType } from "../types/loyalty";

export const RULE_LABELS: Record<EarningRuleType, string> = {
  points_per_dollar: "Points per dollar spent ($1 = X)",
  first_order_bonus: "First order bonus",
  second_order_bonus: "2nd order bonus",
  third_order_bonus: "3rd order bonus",
  bulk_order_bonus: "Bulk order bonus",
  account_creation: "Account creation",
  birthday: "Birthday",
  review_text: "Text review",
  review_photo: "Photo review",
  ugc_video: "UGC video",
  referral: "Referral",
};

export const REWARD_TYPE_LABELS: Record<RedemptionRewardType, string> = {
  fixed_amount: "Fixed amount ($)",
  percentage: "Percentage (%)",
  free_shipping: "Free shipping",
  free_product: "Free product",
};
