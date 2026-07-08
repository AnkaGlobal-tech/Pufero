/** Klaviyo metric names — brand-neutral, safe for client + server imports. */
export const KLAVIYO_METRICS = {
  welcome: "Loyalty Welcome",
  pointsEarned: "Loyalty Points Earned",
  pointsRedeemed: "Loyalty Points Redeemed",
  tierChanged: "Loyalty Tier Changed",
  pointsExpiring30d: "Loyalty Points Expiring Soon",
  pointsExpiring7d: "Loyalty Points Expiring Soon",
  pointsExpired: "Loyalty Points Expired",
  reviewEarned: "Loyalty Review Points Earned",
  connectionTest: "Loyalty Connection Test",
} as const;

export const KLAVIYO_PROFILE_KEYS = {
  pointsBalance: "loyalty_points_balance",
  tier: "loyalty_tier",
  tierSlug: "loyalty_tier_slug",
  member: "loyalty_member",
  memberSince: "loyalty_member_since",
} as const;

export const KLAVIYO_FLOW_GUIDE = [
  {
    metric: KLAVIYO_METRICS.welcome,
    title: "Welcome / launch email",
    body: 'Trigger when someone receives "Loyalty Welcome". Use event properties for balance and earning hints.',
  },
  {
    metric: KLAVIYO_METRICS.pointsEarned,
    title: "Points earned",
    body: "Send after each purchase or bonus. Properties: points, source, description.",
  },
  {
    metric: KLAVIYO_METRICS.pointsRedeemed,
    title: "Redemption confirmation",
    body: "Send when a member redeems points for a coupon.",
  },
  {
    metric: KLAVIYO_METRICS.reviewEarned,
    title: "Review thank-you / photo review promo",
    body: "Fires after Judge.me review points. Use for photo review campaigns.",
  },
  {
    metric: KLAVIYO_METRICS.pointsExpiring30d,
    title: "Points expiring reminder",
    body: "Use profile property loyalty_points_balance + expiry event properties.",
  },
] as const;
