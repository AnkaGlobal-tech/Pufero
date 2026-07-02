/** Supabase enum types — keep in sync with migration files. */

export type LedgerMovementType =
  | "earn"
  | "redeem"
  | "refund_reversal"
  | "cancel_reversal"
  | "expired"
  | "manual";

export type LedgerSource =
  | "purchase"
  | "review_text"
  | "review_photo"
  | "ugc_video"
  | "referral"
  | "manual"
  | "campaign"
  | "birthday"
  | "account_creation"
  | "first_order_bonus"
  | "second_order_bonus"
  | "third_order_bonus"
  | "bulk_order_bonus";

export type EarningRuleType =
  | "points_per_dollar"
  | "first_order_bonus"
  | "second_order_bonus"
  | "third_order_bonus"
  | "bulk_order_bonus"
  | "account_creation"
  | "birthday"
  | "review_text"
  | "review_photo"
  | "ugc_video"
  | "referral";

export type RedemptionRewardType =
  | "fixed_amount"
  | "percentage"
  | "free_shipping"
  | "free_product";

export type WebhookEventStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed";

export type ExpiryJobStatus =
  | "pending"
  | "reminded_30d"
  | "reminded_7d"
  | "expired"
  | "cancelled";
