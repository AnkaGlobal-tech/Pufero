import { getSupabaseAdmin } from "./supabase.server";
import {
  DEFAULT_WIDGET_SETTINGS,
  parseWidgetSettings,
  LOCALE_COPY_FIELDS,
  type WidgetSettings,
} from "./widget-settings";
import type { WidgetLocaleCopy } from "./widget-i18n";
import { normalizeLocaleCode } from "./widget-i18n";

export type { WidgetSettings };

export async function getWidgetSettingsForStore(
  storeId: string,
): Promise<WidgetSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    throw new Error(`widget settings fetch failed: ${error?.message}`);
  }

  return parseWidgetSettings(data.widget_settings);
}

function parseLocaleCopyFromForm(
  form: FormData,
  locale: string,
): Partial<WidgetLocaleCopy> {
  const copy: Partial<WidgetLocaleCopy> = {};
  for (const field of LOCALE_COPY_FIELDS) {
    const value = String(form.get(`locale_${locale}_${field.key}`) ?? "").trim();
    if (value) {
      copy[field.key] = value;
    }
  }
  return copy;
}

export async function updateWidgetSettings(
  storeId: string,
  form: FormData,
): Promise<void> {
  const localeCodes = String(form.get("locale_codes") ?? "")
    .split(",")
    .map((s) => normalizeLocaleCode(s.trim()))
    .filter(Boolean);

  const locales: Record<string, Partial<WidgetLocaleCopy>> = {};
  for (const code of localeCodes) {
    const copy = parseLocaleCopyFromForm(form, code);
    if (Object.keys(copy).length > 0) {
      locales[code] = copy;
    }
  }

  const panelDirection = String(form.get("panel_direction") ?? "up");
  const validDirections = ["up", "left", "right"] as const;

  const settings: WidgetSettings = {
    enabled: form.get("widget_enabled") === "on",
    primary_color:
      String(form.get("primary_color") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.primary_color,
    background_color:
      String(form.get("background_color") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.background_color,
    text_color:
      String(form.get("text_color") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.text_color,
    position:
      form.get("position") === "bottom-left" ? "bottom-left" : "bottom-right",
    panel_direction: validDirections.includes(
      panelDirection as (typeof validDirections)[number],
    )
      ? (panelDirection as WidgetSettings["panel_direction"])
      : "up",
    nudge_enabled: form.get("nudge_enabled") === "on",
    show_tier_progress: form.get("show_tier_progress") === "on",
    show_earn_tab: form.get("show_earn_tab") === "on",
    show_redeem_tab: form.get("show_redeem_tab") === "on",
    cart_slider_enabled: form.get("cart_slider_enabled") === "on",
    cart_slider_min_points: Math.max(
      0,
      Math.floor(Number(form.get("cart_slider_min_points") ?? 0)),
    ),
    cart_slider_max_points: Math.max(
      0,
      Math.floor(Number(form.get("cart_slider_max_points") ?? 0)),
    ),
    default_locale: normalizeLocaleCode(
      String(form.get("default_locale") ?? DEFAULT_WIDGET_SETTINGS.default_locale),
    ),
    locales,
  };

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("stores")
    .update({ widget_settings: settings })
    .eq("id", storeId);

  if (error) {
    throw new Error(`widget settings update failed: ${error.message}`);
  }
}
