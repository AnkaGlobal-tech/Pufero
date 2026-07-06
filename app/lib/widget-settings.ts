import type { WidgetLocaleCopy } from "./widget-i18n";
import {
  WIDGET_LOCALE_DEFAULTS,
  normalizeLocaleCode,
} from "./widget-i18n";

export type WidgetPosition = "bottom-right" | "bottom-left";
/** Panel open direction relative to launcher */
export type WidgetPanelDirection = "up" | "left" | "right";

export interface WidgetSettings {
  enabled: boolean;
  primary_color: string;
  background_color: string;
  text_color: string;
  position: WidgetPosition;
  panel_direction: WidgetPanelDirection;
  nudge_enabled: boolean;
  /** Tier bar + progress in panel header */
  show_tier_progress: boolean;
  /** Earn tab (how to earn / point value) */
  show_earn_tab: boolean;
  /** Redeem tab + coupon creation */
  show_redeem_tab: boolean;
  default_locale: string;
  locales: Record<string, Partial<WidgetLocaleCopy>>;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  enabled: true,
  primary_color: "#C9A84C",
  background_color: "#0F1B2D",
  text_color: "#F7F5F0",
  position: "bottom-right",
  panel_direction: "up",
  nudge_enabled: true,
  show_tier_progress: true,
  show_earn_tab: true,
  show_redeem_tab: true,
  default_locale: "en",
  locales: {},
};

/** Migrate legacy flat text fields into locales map */
function migrateLegacySettings(
  obj: Record<string, unknown>,
): Record<string, Partial<WidgetLocaleCopy>> {
  if (obj.locales && typeof obj.locales === "object") {
    return obj.locales as Record<string, Partial<WidgetLocaleCopy>>;
  }

  const legacy: Partial<WidgetLocaleCopy> = {};
  if (obj.launcher_label) legacy.launcher_label = String(obj.launcher_label);
  if (obj.nudge_text) legacy.nudge_text = String(obj.nudge_text);
  if (obj.guest_headline) legacy.guest_headline = String(obj.guest_headline);
  if (obj.guest_body) legacy.guest_body = String(obj.guest_body);

  if (Object.keys(legacy).length === 0) {
    return {};
  }

  const locale = normalizeLocaleCode(
    String(obj.default_locale ?? "tr"),
  );
  return { [locale]: legacy };
}

export function parseWidgetSettings(raw: unknown): WidgetSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const panelDirection = String(obj.panel_direction ?? "up");
  const validDirections = ["up", "left", "right"] as const;

  return {
    enabled: obj.enabled !== false,
    primary_color: String(
      obj.primary_color ?? DEFAULT_WIDGET_SETTINGS.primary_color,
    ),
    background_color: String(
      obj.background_color ?? DEFAULT_WIDGET_SETTINGS.background_color,
    ),
    text_color: String(obj.text_color ?? DEFAULT_WIDGET_SETTINGS.text_color),
    position:
      obj.position === "bottom-left" ? "bottom-left" : "bottom-right",
    panel_direction: validDirections.includes(
      panelDirection as WidgetPanelDirection,
    )
      ? (panelDirection as WidgetPanelDirection)
      : "up",
    nudge_enabled: obj.nudge_enabled !== false,
    show_tier_progress: obj.show_tier_progress !== false,
    show_earn_tab: obj.show_earn_tab !== false,
    show_redeem_tab: obj.show_redeem_tab !== false,
    default_locale: normalizeLocaleCode(
      String(obj.default_locale ?? DEFAULT_WIDGET_SETTINGS.default_locale),
    ),
    locales: migrateLegacySettings(obj),
  };
}

export function formatNudgeText(template: string, balance: number): string {
  return template.replace(/\{\{balance\}\}/g, String(Math.max(0, balance)));
}

export const WIDGET_FEATURE_FIELDS: Array<{
  key: keyof Pick<
    WidgetSettings,
    "show_tier_progress" | "show_earn_tab" | "show_redeem_tab" | "nudge_enabled"
  >;
  label: string;
  help?: string;
}> = [
  {
    key: "nudge_enabled",
    label: "Show nudge bubble",
    help: "Teaser above the launcher when the customer has points",
  },
  {
    key: "show_tier_progress",
    label: "Show tier progress",
    help: "Tier name, progress bar, and next-tier hint in the panel header",
  },
  {
    key: "show_earn_tab",
    label: "Show Earn tab",
    help: "How customers earn points and point value",
  },
  {
    key: "show_redeem_tab",
    label: "Show Redeem / coupons",
    help: "Coupon tiers and create-coupon buttons. When off, only balance (and optional tier) is shown",
  },
];

export const LOCALE_COPY_FIELDS: Array<{
  key: keyof WidgetLocaleCopy;
  label: string;
  multiline?: boolean;
  help?: string;
}> = [
  { key: "launcher_label", label: "Launcher button" },
  {
    key: "nudge_text",
    label: "Nudge bubble",
    help: "{{balance}} = points balance",
  },
  { key: "guest_headline", label: "Guest headline" },
  {
    key: "guest_body",
    label: "Guest description",
    multiline: true,
    help: "{{points_per_dollar}} available",
  },
  { key: "tab_earn", label: "Tab: Earn" },
  { key: "tab_spend", label: "Tab: Spend" },
  { key: "create_coupon", label: "Create coupon button" },
  { key: "points_label", label: "Points label (below balance)" },
  {
    key: "spend_to_next",
    label: "Next tier message",
    help: "{{amount}}, {{tier}}",
  },
  { key: "top_tier", label: "Top tier message" },
];

export function defaultCopyForLocale(locale: string): WidgetLocaleCopy {
  const code = normalizeLocaleCode(locale);
  return (
    WIDGET_LOCALE_DEFAULTS[code] ??
    WIDGET_LOCALE_DEFAULTS.en
  );
}
