import { getSupabaseAdmin } from "./supabase.server";
import {
  buildJudgemeWebhookUrl,
  ensureJudgemeWebhookToken,
} from "./judgeme-settings.server";

export { regenerateJudgemeWebhookToken as regenerateJudgeMeToken } from "./judgeme-settings.server";

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
  testCurl: string;
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

  if (!error && data) {
    const row = data as Record<string, unknown>;
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

  return getMonthlyReportDirect(storeId, year, month);
}

async function getMonthlyReportDirect(
  storeId: string,
  year: number,
  month: number,
): Promise<MonthlyReport> {
  const supabase = getSupabaseAdmin();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [membersRes, ledgerRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, created_at")
      .eq("store_id", storeId),
    supabase
      .from("points_ledger")
      .select("customer_id, points, source, shopify_order_id, created_at")
      .eq("store_id", storeId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
  ]);

  if (membersRes.error) {
    throw new Error(`monthly report members failed: ${membersRes.error.message}`);
  }
  if (ledgerRes.error) {
    throw new Error(`monthly report ledger failed: ${ledgerRes.error.message}`);
  }

  const ledger = ledgerRes.data ?? [];
  const newMembers = (membersRes.data ?? []).filter(
    (row) => row.created_at >= startIso && row.created_at < endIso,
  ).length;

  let pointsEarned = 0;
  let pointsRedeemed = 0;
  let referralPoints = 0;
  let reviewPoints = 0;
  const activeCustomers = new Set<string>();
  const orders = new Set<number>();

  for (const row of ledger) {
    const points = toNumber(row.points);
    if (points > 0) {
      pointsEarned += points;
      if (row.source === "referral") referralPoints += points;
      if (
        row.source === "review_text" ||
        row.source === "review_photo" ||
        row.source === "ugc_video"
      ) {
        reviewPoints += points;
      }
    } else if (points < 0) {
      pointsRedeemed += Math.abs(points);
    }
    activeCustomers.add(row.customer_id as string);
    if (row.shopify_order_id != null && points > 0) {
      orders.add(row.shopify_order_id as number);
    }
  }

  return {
    year,
    month,
    new_members: newMembers,
    active_members: activeCustomers.size,
    points_earned: pointsEarned,
    points_redeemed: pointsRedeemed,
    referral_points: referralPoints,
    review_points: reviewPoints,
    orders_with_points: orders.size,
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

  if (!error && data) {
    const row = data as Record<string, unknown>;
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

  return getProgramHealthDirect(storeId);
}

async function getProgramHealthDirect(storeId: string): Promise<ProgramHealth> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stuckBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [ledgerRes, failedRes, stuckRes] = await Promise.all([
    supabase.from("points_ledger").select("customer_id, points").eq("store_id", storeId),
    supabase
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "failed")
      .gte("created_at", since),
    supabase
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "processing")
      .lt("created_at", stuckBefore),
  ]);

  if (ledgerRes.error) {
    throw new Error(`program health ledger failed: ${ledgerRes.error.message}`);
  }

  const balanceByCustomer = new Map<string, number>();
  for (const row of ledgerRes.data ?? []) {
    const id = row.customer_id as string;
    balanceByCustomer.set(
      id,
      (balanceByCustomer.get(id) ?? 0) + toNumber(row.points),
    );
  }
  const negativeBalanceCount = [...balanceByCustomer.values()].filter(
    (b) => b < 0,
  ).length;

  const { data: dupRows, error: dupError } = await supabase
    .from("points_ledger")
    .select("source_id, movement_type")
    .eq("store_id", storeId)
    .not("source_id", "is", null);

  if (dupError) {
    throw new Error(`program health duplicates failed: ${dupError.message}`);
  }

  const dupMap = new Map<string, number>();
  for (const row of dupRows ?? []) {
    const key = `${row.source_id}::${row.movement_type}`;
    dupMap.set(key, (dupMap.get(key) ?? 0) + 1);
  }

  const duplicateSourceIds: HealthDuplicateSource[] = [];
  for (const [key, cnt] of dupMap) {
    if (cnt <= 1) continue;
    const [source_id, movement_type] = key.split("::");
    duplicateSourceIds.push({ source_id, movement_type, cnt });
    if (duplicateSourceIds.length >= 20) break;
  }

  return {
    negative_balance_count: negativeBalanceCount,
    duplicate_source_ids: duplicateSourceIds,
    failed_webhooks_7d: failedRes.count ?? 0,
    stuck_webhooks: stuckRes.count ?? 0,
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

export async function getJudgeMeSettings(params: {
  storeId: string;
  appUrl: string;
  shopDomain: string;
}): Promise<JudgeMeSettings> {
  const stored = await ensureJudgemeWebhookToken(params.storeId);
  const webhookUrl = buildJudgemeWebhookUrl({
    appUrl: params.appUrl,
    shopDomain: params.shopDomain,
    token: stored.webhookToken,
  });

  const samplePayload = JSON.stringify(
    {
      event: "review/published",
      shop_domain: params.shopDomain,
      review: {
        id: 999001,
        hidden: false,
        rating: 5,
        body: "Test review from Anka Loyalty",
        pictures: [],
        reviewer: { email: "customer@example.com", name: "Test Customer" },
      },
    },
    null,
    2,
  );

  const testCurl = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '${samplePayload.replace(/'/g, "'\\''")}'`;

  return {
    webhookToken: stored.webhookToken,
    connectedAt: stored.connectedAt,
    webhookUrl,
    testCurl,
  };
}
