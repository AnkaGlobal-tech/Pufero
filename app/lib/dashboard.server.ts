import { getSupabaseAdmin } from "./supabase.server";

export interface TierDistribution {
  name: string;
  slug: string;
  count: number;
}

export interface DashboardStats {
  total_members: number;
  active_members: number;
  points_earned: number;
  points_redeemed: number;
  net_points: number;
  tier_distribution: TierDistribution[];
}

export interface ActivityItem {
  id: string;
  movement_type: string;
  points: number;
  description: string | null;
  created_at: string;
  customer_name: string;
}

const EMPTY_STATS: DashboardStats = {
  total_members: 0,
  active_members: 0,
  points_earned: 0,
  points_redeemed: 0,
  net_points: 0,
  tier_distribution: [],
};

export async function getDashboardStats(storeId: string): Promise<DashboardStats> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("store_dashboard_stats", {
    p_store_id: storeId,
  });

  if (error) {
    throw new Error(`dashboard stats failed: ${error.message}`);
  }

  return (data as DashboardStats) ?? EMPTY_STATS;
}

interface LedgerJoinRow {
  id: string;
  movement_type: string;
  points: number;
  description: string | null;
  created_at: string;
  customers: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

function formatCustomerName(c: LedgerJoinRow["customers"]): string {
  if (!c) return "Unknown customer";
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || "Unnamed customer";
}

export async function getRecentActivity(
  storeId: string,
  limit = 10,
): Promise<ActivityItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select(
      "id, movement_type, points, description, created_at, customers(first_name, last_name, email)",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`recent activity failed: ${error.message}`);
  }

  return (data as unknown as LedgerJoinRow[]).map((row) => ({
    id: row.id,
    movement_type: row.movement_type,
    points: row.points,
    description: row.description,
    created_at: row.created_at,
    customer_name: formatCustomerName(row.customers),
  }));
}
