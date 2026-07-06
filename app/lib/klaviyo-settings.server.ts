import { getSupabaseAdmin } from "./supabase.server";

export interface KlaviyoIntegrationSettings {
  apiKey: string;
  connectedAt: string | null;
  backfillCompletedAt: string | null;
  welcomeSentAt: string | null;
}

interface KlaviyoWidgetBlock {
  api_key?: string;
  connected_at?: string | null;
  backfill_completed_at?: string | null;
  welcome_sent_at?: string | null;
}

function readFromWidgetSettings(raw: unknown): KlaviyoIntegrationSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const integrations = (raw as Record<string, unknown>).integrations;
  if (!integrations || typeof integrations !== "object") return null;
  const klaviyo = (integrations as Record<string, unknown>).klaviyo as
    | KlaviyoWidgetBlock
    | undefined;
  if (!klaviyo?.api_key?.trim()) return null;
  return {
    apiKey: klaviyo.api_key.trim(),
    connectedAt: klaviyo.connected_at ?? null,
    backfillCompletedAt: klaviyo.backfill_completed_at ?? null,
    welcomeSentAt: klaviyo.welcome_sent_at ?? null,
  };
}

export async function loadKlaviyoSettings(
  storeId: string,
): Promise<KlaviyoIntegrationSettings | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("stores")
    .select(
      "klaviyo_api_key, klaviyo_connected_at, widget_settings",
    )
    .eq("id", storeId)
    .single();

  if (error) {
    const { data: fallback } = await supabase
      .from("stores")
      .select("widget_settings")
      .eq("id", storeId)
      .single();
    return readFromWidgetSettings(fallback?.widget_settings);
  }

  const columnKey = data.klaviyo_api_key as string | null;
  if (columnKey?.trim()) {
    const widget = readFromWidgetSettings(data.widget_settings);
    return {
      apiKey: columnKey.trim(),
      connectedAt:
        (data.klaviyo_connected_at as string | null) ??
        widget?.connectedAt ??
        null,
      backfillCompletedAt: widget?.backfillCompletedAt ?? null,
      welcomeSentAt: widget?.welcomeSentAt ?? null,
    };
  }

  return readFromWidgetSettings(data.widget_settings);
}

export async function saveKlaviyoSettings(
  storeId: string,
  settings: KlaviyoIntegrationSettings,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: store, error: fetchError } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", storeId)
    .single();

  if (fetchError || !store) {
    throw new Error(`store fetch failed: ${fetchError?.message ?? "no row"}`);
  }

  const widgetSettings =
    store.widget_settings && typeof store.widget_settings === "object"
      ? (store.widget_settings as Record<string, unknown>)
      : {};

  const integrations =
    widgetSettings.integrations && typeof widgetSettings.integrations === "object"
      ? (widgetSettings.integrations as Record<string, unknown>)
      : {};

  const mergedSettings = {
    ...widgetSettings,
    integrations: {
      ...integrations,
      klaviyo: {
        api_key: settings.apiKey,
        connected_at: settings.connectedAt,
        backfill_completed_at: settings.backfillCompletedAt,
        welcome_sent_at: settings.welcomeSentAt,
      },
    },
  };

  const { error: widgetError } = await supabase
    .from("stores")
    .update({ widget_settings: mergedSettings })
    .eq("id", storeId);

  if (widgetError) {
    throw new Error(`klaviyo settings save failed: ${widgetError.message}`);
  }

  const { error: columnError } = await supabase
    .from("stores")
    .update({
      klaviyo_api_key: settings.apiKey,
      klaviyo_connected_at: settings.connectedAt,
    })
    .eq("id", storeId);

  if (columnError) {
    console.warn(
      `[klaviyo] column update skipped (${columnError.message}) — widget_settings used`,
    );
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 6)}${"•".repeat(Math.min(12, key.length - 10))}${key.slice(-4)}`;
}
