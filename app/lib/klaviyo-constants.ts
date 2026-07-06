/** Klaviyo metric names — safe for client + server imports. */
export const KLAVIYO_METRICS = {
  welcome: "Anka Loyalty Welcome",
  pointsEarned: "Anka Points Earned",
  pointsRedeemed: "Anka Points Redeemed",
  tierChanged: "Anka Tier Changed",
  pointsExpiring30d: "Anka Points Expiring Soon",
  pointsExpiring7d: "Anka Points Expiring Soon",
  pointsExpired: "Anka Points Expired",
  reviewEarned: "Anka Review Points Earned",
  connectionTest: "Anka Loyalty Connection Test",
} as const;

export const KLAVIYO_FLOW_GUIDE = [
  {
    metric: KLAVIYO_METRICS.welcome,
    title: "Welcome / launch email",
    body: 'Trigger when someone receives "Anka Loyalty Welcome". Use event properties for balance and earning hints.',
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
    body: "Use profile property anka_points_balance + expiry event properties.",
  },
] as const;
