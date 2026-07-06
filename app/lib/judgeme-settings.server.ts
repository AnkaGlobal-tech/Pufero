import { randomBytes } from "node:crypto";

import { getSupabaseAdmin } from "./supabase.server";

export interface JudgemeStoredSettings {
  webhookToken: string;
  connectedAt: string | null;
}

function generateWebhookToken(): string {
  return randomBytes(16).toString("hex");
}

function readFromWidgetSettings(raw: unknown): JudgemeStoredSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const integrations = (raw as Record<string, unknown>).integrations;
  if (!integrations || typeof integrations !== "object") return null;
  const judgeme = (integrations as Record<string, unknown>).judgeme;
  if (!judgeme || typeof judgeme !== "object") return null;
  const token = (judgeme as Record<string, unknown>).webhook_token;
  if (typeof token !== "string" || !token.trim()) return null;
  const connectedAt = (judgeme as Record<string, unknown>).connected_at;
  return {
    webhookToken: token.trim(),
    connectedAt: typeof connectedAt === "string" ? connectedAt : null,
  };
}

/** Read Judge.me webhook token (DB column or widget_settings fallback). */
export async function loadJudgemeSettings(
  storeId: string,
): Promise<JudgemeStoredSettings | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("stores")
    .select("judgeme_webhook_token, judgeme_connected_at, widget_settings")
    .eq("id", storeId)
    .single();

  if (error) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("stores")
      .select("widget_settings")
      .eq("id", storeId)
      .single();

    if (fallbackError || !fallback) {
      return null;
    }
    return readFromWidgetSettings(fallback.widget_settings);
  }

  const columnToken = data.judgeme_webhook_token as string | null;
  if (columnToken) {
    return {
      webhookToken: columnToken,
      connectedAt: (data.judgeme_connected_at as string | null) ?? null,
    };
  }

  return readFromWidgetSettings(data.widget_settings);
}

/** Persist Judge.me webhook token (column when available, always widget_settings). */
export async function saveJudgemeSettings(
  storeId: string,
  settings: JudgemeStoredSettings,
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
      judgeme: {
        webhook_token: settings.webhookToken,
        connected_at: settings.connectedAt,
      },
    },
  };

  const { error: widgetError } = await supabase
    .from("stores")
    .update({ widget_settings: mergedSettings })
    .eq("id", storeId);

  if (widgetError) {
    throw new Error(`judgeme settings save failed: ${widgetError.message}`);
  }

  const { error: columnError } = await supabase
    .from("stores")
    .update({
      judgeme_webhook_token: settings.webhookToken,
      judgeme_connected_at: settings.connectedAt,
    })
    .eq("id", storeId);

  if (columnError) {
    console.warn(
      `[judgeme] column update skipped (${columnError.message}) — using widget_settings`,
    );
  }
}

export async function ensureJudgemeWebhookToken(
  storeId: string,
): Promise<JudgemeStoredSettings> {
  const existing = await loadJudgemeSettings(storeId);
  if (existing?.webhookToken) {
    return existing;
  }

  const created: JudgemeStoredSettings = {
    webhookToken: generateWebhookToken(),
    connectedAt: null,
  };
  await saveJudgemeSettings(storeId, created);
  return created;
}

export async function regenerateJudgemeWebhookToken(
  storeId: string,
): Promise<string> {
  const token = generateWebhookToken();
  await saveJudgemeSettings(storeId, {
    webhookToken: token,
    connectedAt: null,
  });
  return token;
}

export async function markJudgemeConnected(storeId: string): Promise<void> {
  const current = await loadJudgemeSettings(storeId);
  if (!current?.webhookToken) return;

  await saveJudgemeSettings(storeId, {
    webhookToken: current.webhookToken,
    connectedAt: new Date().toISOString(),
  });
}

export async function verifyJudgemeWebhook(params: {
  shopDomain: string;
  token: string;
}): Promise<{ storeId: string } | null> {
  const supabase = getSupabaseAdmin();

  let data: {
    id: string;
    is_active: boolean;
    judgeme_webhook_token?: string | null;
    widget_settings?: unknown;
  } | null = null;

  const full = await supabase
    .from("stores")
    .select("id, shop_domain, judgeme_webhook_token, widget_settings, is_active")
    .eq("shop_domain", params.shopDomain)
    .maybeSingle();

  if (!full.error && full.data) {
    data = full.data;
  } else {
    const fallback = await supabase
      .from("stores")
      .select("id, widget_settings, is_active")
      .eq("shop_domain", params.shopDomain)
      .maybeSingle();
    if (fallback.error || !fallback.data) {
      return null;
    }
    data = fallback.data;
  }

  if (!data?.is_active) {
    return null;
  }

  const columnToken = data.judgeme_webhook_token ?? null;
  const widgetToken = readFromWidgetSettings(data.widget_settings)?.webhookToken;
  const expected = columnToken || widgetToken;

  if (!expected || expected !== params.token) {
    return null;
  }

  return { storeId: data.id as string };
}

export function buildJudgemeWebhookUrl(params: {
  appUrl: string;
  shopDomain: string;
  token: string;
}): string {
  const base = params.appUrl.replace(/\/$/, "");
  return `${base}/webhooks/judgeme?shop=${encodeURIComponent(params.shopDomain)}&token=${encodeURIComponent(params.token)}`;
}
