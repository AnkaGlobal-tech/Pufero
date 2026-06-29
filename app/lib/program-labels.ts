import type { EarningRuleType, RedemptionRewardType } from "../types/loyalty";

export const RULE_LABELS: Record<EarningRuleType, string> = {
  points_per_dollar: "Harcama başına puan ($1 = X)",
  first_order_bonus: "İlk sipariş bonusu",
  second_order_bonus: "2. sipariş bonusu",
  third_order_bonus: "3. sipariş bonusu",
  bulk_order_bonus: "Bulk sipariş bonusu",
  account_creation: "Hesap oluşturma",
  birthday: "Doğum günü",
  review_text: "Yazılı yorum",
  review_photo: "Fotoğraflı yorum",
  ugc_video: "UGC video",
  referral: "Referral (davet)",
};

export const REWARD_TYPE_LABELS: Record<RedemptionRewardType, string> = {
  fixed_amount: "Sabit tutar ($)",
  percentage: "Yüzde (%)",
  free_shipping: "Ücretsiz kargo",
  free_product: "Ücretsiz ürün",
};
