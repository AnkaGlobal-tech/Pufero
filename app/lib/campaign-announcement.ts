import type { CampaignRow } from "./campaign-engine.server";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Mağazanın kopyalayabileceği kampanya duyuru metni. */
export function buildCampaignAnnouncementText(campaign: CampaignRow): string {
  const scope =
    campaign.collection_ids.length > 0
      ? "seçili koleksiyonlardaki ürünlerde"
      : "tüm alışverişlerinizde";

  return [
    `🎉 ${campaign.name}`,
    "",
    `${fmtDate(campaign.starts_at)} – ${fmtDate(campaign.ends_at)} tarihleri arasında ${scope} ${campaign.multiplier}x puan kazanın!`,
    "",
    "Sadakat puanlarınızı hesabınızdan takip edebilir, ödüllere dönüştürebilirsiniz.",
    "",
    "#sadakat #puankazan",
  ].join("\n");
}
