import { getSupabaseAdmin } from "./supabase.server";
import { parseWidgetSettings } from "./widget-settings";

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export interface LandingTierRow {
  name: string;
  slug: string;
  thresholdSpend: number;
  discountPercent: number | null;
  pointsMultiplier: number;
}

export interface LandingPayload {
  ok: true;
  programPaused: boolean;
  pointsPerDollar: number;
  pointsToDollarRatio: number;
  tiers: LandingTierRow[];
  faq: LandingFaqItem[];
  settings: {
    primaryColor: string;
    backgroundColor: string;
    textColor: string;
  };
}

const DEFAULT_FAQ: LandingFaqItem[] = [
  {
    question: "How do I earn points?",
    answer:
      "Create an account and shop as usual. Points are added automatically after each eligible order.",
  },
  {
    question: "How do I redeem points?",
    answer:
      "Use the rewards widget on the store or your account rewards page to convert points into discount coupons.",
  },
  {
    question: "Do points expire?",
    answer:
      "If your store enables expiry, points may expire after a period of inactivity. Check your account for details.",
  },
  {
    question: "How do tiers work?",
    answer:
      "Your lifetime spend unlocks higher tiers with better benefits. Tiers update automatically after purchases.",
  },
];

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Public rewards program landing page data (no login). */
export async function getLandingPayload(
  storeId: string,
): Promise<LandingPayload | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();

  const { data: store, error } = await supabase
    .from("stores")
    .select(
      "program_paused, points_per_dollar, points_to_dollar_ratio, widget_settings",
    )
    .eq("id", storeId)
    .single();

  if (error || !store) {
    return { ok: false, error: "Program unavailable." };
  }

  const settings = parseWidgetSettings(store.widget_settings);

  const { data: tierRows, error: tiersError } = await supabase
    .from("tiers")
    .select("name, slug, threshold_spend, discount_percent, points_multiplier")
    .eq("store_id", storeId)
    .order("threshold_spend", { ascending: true });

  if (tiersError) {
    return { ok: false, error: "Could not load tiers." };
  }

  const tiers: LandingTierRow[] = (tierRows ?? []).map((t) => ({
    name: t.name,
    slug: t.slug,
    thresholdSpend: toNumber(t.threshold_spend),
    discountPercent:
      t.discount_percent != null ? toNumber(t.discount_percent) : null,
    pointsMultiplier: toNumber(t.points_multiplier) || 1,
  }));

  const rawFaq = (settings as { landing_faq?: LandingFaqItem[] }).landing_faq;
  const faq =
    Array.isArray(rawFaq) && rawFaq.length > 0 ? rawFaq : DEFAULT_FAQ;

  return {
    ok: true,
    programPaused: Boolean(store.program_paused),
    pointsPerDollar: toNumber(store.points_per_dollar),
    pointsToDollarRatio: toNumber(store.points_to_dollar_ratio),
    tiers,
    faq,
    settings: {
      primaryColor: settings.primary_color,
      backgroundColor: settings.background_color,
      textColor: settings.text_color,
    },
  };
}
