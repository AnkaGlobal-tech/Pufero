/** Storefront widget metinleri — dil bazlı. */
export interface WidgetLocaleCopy {
  launcher_label: string;
  nudge_text: string;
  guest_headline: string;
  guest_body: string;
  points_label: string;
  tab_earn: string;
  tab_spend: string;
  create_coupon: string;
  creating_coupon: string;
  close_label: string;
  top_tier: string;
  /** {{amount}} ve {{tier}} yer tutucuları */
  spend_to_next: string;
  earn_per_dollar: string;
  earn_per_dollar_hint: string;
  points_value_title: string;
  points_value_hint: string;
  estimated_value: string;
  estimated_value_hint: string;
  login_for_spend: string;
  no_redemptions: string;
  register_cta: string;
  login_cta: string;
  /** {{code}}, {{points}} */
  coupon_success: string;
}

export const WIDGET_LOCALE_DEFAULTS: Record<string, WidgetLocaleCopy> = {
  en: {
    launcher_label: "Rewards",
    nudge_text: "You have {{balance}} points! 💰",
    guest_headline: "Join our rewards program",
    guest_body:
      "Earn {{points_per_dollar}} points per $1 spent. Redeem points for exclusive discounts.",
    points_label: "points",
    tab_earn: "Earn",
    tab_spend: "Redeem",
    create_coupon: "Create coupon",
    creating_coupon: "Creating…",
    close_label: "Close",
    top_tier: "You've reached the top tier 🎉",
    spend_to_next: "Spend {{amount}} more → {{tier}}",
    earn_per_dollar: "$1 = {{points}} points",
    earn_per_dollar_hint: "Earn automatically on every purchase.",
    points_value_title: "Point value",
    points_value_hint: "{{ratio}} points ≈ $1 off",
    estimated_value: "Estimated value",
    estimated_value_hint: "Your balance ≈ {{amount}}",
    login_for_spend: "Sign in to redeem rewards.",
    no_redemptions: "No reward tiers available yet.",
    register_cta: "Create account",
    login_cta: "Sign in",
    coupon_success: "Your code: {{code}} (−{{points}} points)",
  },
  tr: {
    launcher_label: "Ödüller",
    nudge_text: "{{balance}} puanın var! 💰",
    guest_headline: "Sadakat programına katılın",
    guest_body:
      "Her $1 harcamada {{points_per_dollar}} puan kazanın. Puanlarınızı indirim kuponlarına dönüştürün.",
    points_label: "puan",
    tab_earn: "Kazan",
    tab_spend: "Harca",
    create_coupon: "Kupon oluştur",
    creating_coupon: "Oluşturuluyor…",
    close_label: "Kapat",
    top_tier: "En üst seviyedesiniz 🎉",
    spend_to_next: "{{amount}} daha harcayın → {{tier}}",
    earn_per_dollar: "Her $1 = {{points}} puan",
    earn_per_dollar_hint: "Satın almalarınızdan otomatik kazanırsınız.",
    points_value_title: "Puan değeri",
    points_value_hint: "{{ratio}} puan ≈ $1 indirim",
    estimated_value: "Tahmini değer",
    estimated_value_hint: "Bakiyeniz ≈ {{amount}}",
    login_for_spend: "Harca sekmesi için giriş yapın.",
    no_redemptions: "Henüz aktif kupon kademesi yok.",
    register_cta: "Hesap oluştur",
    login_cta: "Giriş yap",
    coupon_success: "Kupon kodunuz: {{code}} (−{{points}} puan)",
  },
};

export function normalizeLocaleCode(raw: string | null | undefined): string {
  if (!raw) return "en";
  const code = raw.toLowerCase().split("-")[0];
  return code || "en";
}

export function resolveWidgetCopy(
  locales: Record<string, Partial<WidgetLocaleCopy>>,
  defaultLocale: string,
  requestedLocale: string,
): { locale: string; copy: WidgetLocaleCopy } {
  const req = normalizeLocaleCode(requestedLocale);
  const def = normalizeLocaleCode(defaultLocale);

  const merge = (code: string): WidgetLocaleCopy | null => {
    const base =
      WIDGET_LOCALE_DEFAULTS[code] ??
      WIDGET_LOCALE_DEFAULTS.en ??
      WIDGET_LOCALE_DEFAULTS.tr;
    const custom = locales[code] ?? locales[`${code}-${code}`];
    if (!base && !custom) return null;
    return { ...base, ...custom } as WidgetLocaleCopy;
  };

  for (const code of [req, def, "en", "tr"]) {
    const copy = merge(code);
    if (copy) {
      return { locale: code, copy };
    }
  }

  return {
    locale: "en",
    copy: WIDGET_LOCALE_DEFAULTS.en,
  };
}

export function interpolateCopy(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : "",
  );
}

/** Shopify locale kodundan okunabilir etiket */
export function localeDisplayName(code: string): string {
  const names: Record<string, string> = {
    en: "English",
    tr: "Türkçe",
    de: "Deutsch",
    fr: "Français",
    es: "Español",
    it: "Italiano",
    nl: "Nederlands",
    pt: "Português",
    ar: "العربية",
    ja: "日本語",
    ko: "한국어",
    zh: "中文",
  };
  const base = normalizeLocaleCode(code);
  return names[base] ?? code.toUpperCase();
}
