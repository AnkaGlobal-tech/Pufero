export interface WidgetSettings {
  enabled: boolean;
  primary_color: string;
  background_color: string;
  text_color: string;
  position: "bottom-right" | "bottom-left";
  nudge_enabled: boolean;
  nudge_text: string;
  launcher_label: string;
  guest_headline: string;
  guest_body: string;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  enabled: true,
  primary_color: "#C9A84C",
  background_color: "#0F1B2D",
  text_color: "#F7F5F0",
  position: "bottom-right",
  nudge_enabled: true,
  nudge_text: "{{balance}} puanın var! 💰",
  launcher_label: "Ödüller",
  guest_headline: "Sadakat programına katılın",
  guest_body:
    "Her alışverişinizde puan kazanın. Puanlarınızı indirim kuponlarına dönüştürün.",
};

export function parseWidgetSettings(raw: unknown): WidgetSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: obj.enabled !== false,
    primary_color: String(obj.primary_color ?? DEFAULT_WIDGET_SETTINGS.primary_color),
    background_color: String(
      obj.background_color ?? DEFAULT_WIDGET_SETTINGS.background_color,
    ),
    text_color: String(obj.text_color ?? DEFAULT_WIDGET_SETTINGS.text_color),
    position:
      obj.position === "bottom-left" ? "bottom-left" : "bottom-right",
    nudge_enabled: obj.nudge_enabled !== false,
    nudge_text: String(obj.nudge_text ?? DEFAULT_WIDGET_SETTINGS.nudge_text),
    launcher_label: String(
      obj.launcher_label ?? DEFAULT_WIDGET_SETTINGS.launcher_label,
    ),
    guest_headline: String(
      obj.guest_headline ?? DEFAULT_WIDGET_SETTINGS.guest_headline,
    ),
    guest_body: String(obj.guest_body ?? DEFAULT_WIDGET_SETTINGS.guest_body),
  };
}

export function formatNudgeText(template: string, balance: number): string {
  return template.replace(/\{\{balance\}\}/g, String(Math.max(0, balance)));
}
