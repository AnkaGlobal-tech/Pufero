import type { CampaignRow } from "./campaign-engine.server";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Copy-paste campaign announcement text for merchants. */
export function buildCampaignAnnouncementText(campaign: CampaignRow): string {
  const scope =
    campaign.collection_ids.length > 0
      ? "on products in selected collections"
      : "on all purchases";

  return [
    `🎉 ${campaign.name}`,
    "",
    `Earn ${campaign.multiplier}x points ${scope} from ${fmtDate(campaign.starts_at)} through ${fmtDate(campaign.ends_at)}!`,
    "",
    "Track your loyalty points in your account and redeem them for rewards.",
    "",
    "#loyalty #earnpoints",
  ].join("\n");
}
