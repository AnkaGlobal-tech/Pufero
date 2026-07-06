import { randomBytes } from "node:crypto";

import { getSupabaseAdmin } from "./supabase.server";

export interface MonthlyReport {
  year: number;
  month: number;
  new_members: number;
  active_members: number;
  points_earned: number;
  points_redeemed: number;
  referral_points: number;
  review_points: number;
  orders_with_points: number;
}

export interface RoiMetrics {
  pointsToDollarRatio: number;
  redemptionValueUsd: number;
  outstandingPoints: number;
  liabilityUsd: number;
  redemptionRate: number;
  periodPointsEarned: number;
  periodPointsRedeemed: number;
}

export interface HealthDuplicateSource {
  source_id: string;
  movement_type: string;
  cnt: number;
}

export interface ProgramHealth {
  negative_balance_count: number;
  duplicate_source_ids: HealthDuplicateSource[];
  failed_webhooks_7d: number;
  stuck_webhooks: number;
}

export interface JudgeMeSettings {
  webhookToken: string;
  connectedAt: string | null;
  webhookUrl: string;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function parseYearMonth(
  yearRaw: string | null,
  monthRaw: string | null,
): { year: number; month: number } {
  const fallback = currentYearMonth();
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : fallback.year;
  const month = monthRaw ? Number.parseInt(monthRaw, 10) : fallback.month;

  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return fallback;
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { year, month: fallback.month };
  }

  return { year, month };
}

export async function getMonthlyReport(
  storeId: string,
  year: number,
  month: number,
): Promise<MonthlyReport> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("store_monthly_report", {
    p_store_id: storeId,
    p_year: year,
    p_month: month,
  });

  if (error) {
    throw new Error(`monthly report failed: ${error.message}`);
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    year: toNumber(row.year) || year,
    month: toNumber(row.month) || month,
    new_members: toNumber(row.new_members),
    active_members: toNumber(row.active_members),
    points_earned: toNumber(row.points_earned),
    points_redeemed: toNumber(row.points_redeemed),
    referral_points: toNumber(row.referral_points),
    review_points: toNumber(row.review_points),
    orders_with_points: toNumber(row.orders_with_points),
  };
}

export async function getRoiMetrics(
  storeId: string,
  report: MonthlyReport,
): Promise<RoiMetrics> {
  const supabase = getSupabaseAdmin();

  const [storeRes, balanceRes] = await Promise.all([
    supabase
      .from("stores")
      .select("points_to_dollar_ratio")
      .eq("id", storeId)
      .single(),
    supabase.from("points_ledger").select("points").eq("store_id", storeId),
  ]);

  if (storeRes.error || !storeRes.data) {
    throw new Error(`store fetch failed: ${storeRes.error?.message ?? "no row"}`);
  }
  if (balanceRes.error) {
    throw new Error(`balance aggregate failed: ${balanceRes.error.message}`);
  }

  const ratio = Math.max(1, toNumber(storeRes.data.points_to_dollar_ratio));
  const outstandingPoints = (balanceRes.data ?? []).reduce(
    (sum, row) => sum + toNumber(row.points),
    0,
  );

  const earned = report.points_earned;
  const redeemed = report.points_redeemed;

  return {
    pointsToDollarRatio: ratio,
    redemptionValueUsd: redeemed / ratio,
    outstandingPoints,
    liabilityUsd: Math.max(0, outstandingPoints) / ratio,
    redemptionRate: earned > 0 ? redeemed / earned : 0,
    periodPointsEarned: earned,
    periodPointsRedeemed: redeemed,
  };
}

export async function getProgramHealth(storeId: string): Promise<ProgramHealth> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("store_program_health", {
    p_store_id: storeId,
  });

  if (error) {
    throw new Error(`program health failed: ${error.message}`);
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const duplicates = Array.isArray(row.duplicate_source_ids)
    ? (row.duplicate_source_ids as HealthDuplicateSource[])
    : [];

  return {
    negative_balance_count: toNumber(row.negative_balance_count),
    duplicate_source_ids: duplicates,
    failed_webhooks_7d: toNumber(row.failed_webhooks_7d),
    stuck_webhooks: toNumber(row.stuck_webhooks),
  };
}

export async function exportLedgerCsv(params: {
  storeId: string;
  year: number;
  month: number;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  const { data, error } = await supabase
    .from("points_ledger")
    .select(
      "created_at, movement_type, source, points, description, source_id, shopify_order_id, customers(email, first_name, last_name)",
    )
    .eq("store_id", params.storeId)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`ledger export failed: ${error.message}`);
  }

  const header = [
    "created_at",
    "customer_email",
    "customer_name",
    "movement_type",
    "source",
    "points",
    "description",
    "source_id",
    "shopify_order_id",
  ].join(",");

  const escape = (value: unknown) => {
    const str = value == null ? "" : String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  type LedgerExportRow = {
    created_at: string;
    movement_type: string;
    source: string | null;
    points: number;
    description: string | null;
    source_id: string | null;
    shopify_order_id: number | null;
    customers: {
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
  };

  const lines = (data as unknown as LedgerExportRow[]).map((row) => {
    const customer = row.customers;
    const name = customer
      ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
      : "";
    return [
      row.created_at,
      customer?.email ?? "",
      name,
      row.movement_type,
      row.source ?? "",
      row.points,
      row.description ?? "",
      row.source_id ?? "",
      row.shopify_order_id ?? "",
    ]
      .map(escape)
      .join(",");
  });

  return [header, ...lines].join("\n");
}

function generateWebhookToken(): string {
  return randomBytes(16).toString("hex");
}

export async function getJudgeMeSettings(params: {
  storeId: string;
  appUrl: string;
  shopDomain: string;
}): Promise<JudgeMeSettings> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("stores")
    .select("judgeme_webhook_token, judgeme_connected_at")
    .eq("id", params.storeId)
    .single();

  if (error || !data) {
    throw new Error(`store fetch failed: ${error?.message ?? "no row"}`);
  }

  let token = data.judgeme_webhook_token as string | null;
  if (!token) {
    token = generateWebhookToken();
    const { error: updateError } = await supabase
      .from("stores")
      .update({ judgeme_webhook_token: token })
      .eq("id", params.storeId);

    if (updateError) {
      throw new Error(`token save failed: ${updateError.message}`);
    }
  }

  const base = params.appUrl.replace(/\/$/, "");
  const webhookUrl = `${base}/webhooks/judgeme?shop=${encodeURIComponent(params.shopDomain)}&token=${token}`;

  return {
    webhookToken: token,
    connectedAt: (data.judgeme_connected_at as string | null) ?? null,
    webhookUrl,
  };
}

export async function markJudgeMeConnected(storeId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("stores")
    .update({ judgeme_connected_at: new Date().toISOString() })
    .eq("id", storeId);

  if (error) {
    throw new Error(`judgeme connect mark failed: ${error.message}`);
  }
}

export async function regenerateJudgeMeToken(storeId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const token = generateWebhookToken();
  const { error } = await supabase
    .from("stores")
    .update({
      judgeme_webhook_token: token,
      judgeme_connected_at: null,
    })
    .eq("id", storeId);

  if (error) {
    throw new Error(`token regenerate failed: ${error.message}`);
  }

  return token;
}

export async function verifyJudgeMeWebhook(params: {
  shopDomain: string;
  token: string;
}): Promise<{ storeId: string } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("id, shop_domain, judgeme_webhook_token, is_active")
    .eq("shop_domain", params.shopDomain)
    .maybeSingle();

  if (error || !data?.is_active) {
    return null;
  }

  if (data.judgeme_webhook_token !== params.token) {
    return null;
  }

  return { storeId: data.id as string };
}
