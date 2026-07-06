import { getCustomerDetail, getCustomerLedger } from "./customers.server";
import type { LedgerEntry } from "./customers.server";
import { getWidgetPayload, getCustomerIdByShopifyId } from "./widget.server";

export interface PortalCoupon {
  code: string;
  label: string;
  points: number;
  createdAt: string | null;
}

export interface PortalLedgerItem {
  id: string;
  movementType: string;
  points: number;
  description: string | null;
  createdAt: string | null;
}

export interface PortalPayload {
  ok: true;
  widget: Awaited<ReturnType<typeof getWidgetPayload>>;
  member: {
    firstName: string | null;
    email: string | null;
    memberSince: string | null;
    orderCount: number;
    totalSpend: number;
  };
  ledger: PortalLedgerItem[];
  coupons: PortalCoupon[];
  referral: {
    enabled: false;
    message: string;
  };
}

function extractCoupon(entry: LedgerEntry): PortalCoupon | null {
  if (entry.movement_type !== "redeem" || entry.points >= 0) return null;

  const fromMeta =
    entry.metadata &&
    typeof entry.metadata.discount_code === "string"
      ? entry.metadata.discount_code
      : null;
  const fromDesc = entry.description?.match(/coupon:\s*(\S+)/i)?.[1];
  const code = fromMeta || fromDesc;
  if (!code) return null;

  const label =
    entry.description?.split("—")[0]?.trim() || "Reward coupon";

  return {
    code,
    label,
    points: Math.abs(entry.points),
    createdAt: entry.created_at,
  };
}

/** Logged-in customer account portal data. */
export async function getPortalPayload(params: {
  storeId: string;
  shopifyCustomerId: number;
  locale?: string | null;
  currency?: string | null;
}): Promise<PortalPayload | { ok: false; error: string }> {
  const widget = await getWidgetPayload({
    storeId: params.storeId,
    shopifyCustomerId: params.shopifyCustomerId,
    locale: params.locale,
    currency: params.currency,
  });

  if (!widget.isMember || !widget.member) {
    return {
      ok: false,
      error: "No loyalty record yet. Points appear after your first order.",
    };
  }

  const customerId = await getCustomerIdByShopifyId({
    storeId: params.storeId,
    shopifyCustomerId: params.shopifyCustomerId,
  });
  if (!customerId) {
    return { ok: false, error: "Customer not found." };
  }

  const [detail, ledgerRows] = await Promise.all([
    getCustomerDetail(params.storeId, customerId),
    getCustomerLedger(params.storeId, customerId, 50),
  ]);

  if (!detail) {
    return { ok: false, error: "Customer not found." };
  }

  const ledger: PortalLedgerItem[] = ledgerRows.map((row) => ({
    id: row.id,
    movementType: row.movement_type,
    points: row.points,
    description: row.description,
    createdAt: row.created_at,
  }));

  const coupons: PortalCoupon[] = [];
  for (const row of ledgerRows) {
    const coupon = extractCoupon(row);
    if (coupon) coupons.push(coupon);
  }

  return {
    ok: true,
    widget,
    member: {
      firstName: detail.first_name,
      email: detail.email,
      memberSince: detail.created_at,
      orderCount: detail.order_count,
      totalSpend: detail.total_spend,
    },
    ledger,
    coupons,
    referral: {
      enabled: false,
      message: "Referral rewards are coming soon.",
    },
  };
}
