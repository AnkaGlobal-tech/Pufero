import { getSupabaseAdmin } from "./supabase.server";
import {
  DEFAULT_WIDGET_SETTINGS,
  parseWidgetSettings,
  type WidgetSettings,
} from "./widget-settings";

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

export async function updateWidgetSettings(
  storeId: string,
  form: FormData,
): Promise<void> {
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
    nudge_enabled: form.get("nudge_enabled") === "on",
    nudge_text:
      String(form.get("nudge_text") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.nudge_text,
    launcher_label:
      String(form.get("launcher_label") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.launcher_label,
    guest_headline:
      String(form.get("guest_headline") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.guest_headline,
    guest_body:
      String(form.get("guest_body") ?? "").trim() ||
      DEFAULT_WIDGET_SETTINGS.guest_body,
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
