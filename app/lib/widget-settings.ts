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
    default_locale: normalizeLocaleCode(
      String(obj.default_locale ?? DEFAULT_WIDGET_SETTINGS.default_locale),
    ),
    locales: migrateLegacySettings(obj),
  };
}

export function formatNudgeText(template: string, balance: number): string {
  return template.replace(/\{\{balance\}\}/g, String(Math.max(0, balance)));
}

export const LOCALE_COPY_FIELDS: Array<{
  key: keyof WidgetLocaleCopy;
  label: string;
  multiline?: boolean;
  help?: string;
}> = [
  { key: "launcher_label", label: "Launcher butonu" },
  {
    key: "nudge_text",
    label: "Nudge balonu",
    help: "{{balance}} = puan bakiyesi",
  },
  { key: "guest_headline", label: "Misafir başlık" },
  {
    key: "guest_body",
    label: "Misafir açıklama",
    multiline: true,
    help: "{{points_per_dollar}} kullanılabilir",
  },
  { key: "tab_earn", label: "Sekme: Kazan" },
  { key: "tab_spend", label: "Sekme: Harca" },
  { key: "create_coupon", label: "Kupon oluştur butonu" },
  { key: "points_label", label: "Puan etiketi (balance altı)" },
  {
    key: "spend_to_next",
    label: "Sonraki tier metni",
    help: "{{amount}}, {{tier}}",
  },
  { key: "top_tier", label: "En üst tier mesajı" },
];

export function defaultCopyForLocale(locale: string): WidgetLocaleCopy {
  const code = normalizeLocaleCode(locale);
  return (
    WIDGET_LOCALE_DEFAULTS[code] ??
    WIDGET_LOCALE_DEFAULTS.en
  );
}
