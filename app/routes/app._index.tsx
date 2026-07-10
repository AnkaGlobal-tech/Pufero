import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineGrid,
  Badge,
  Box,
  InlineStack,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrEnsureStoreByDomain } from "../lib/store.server";
import { BRAND_DISPLAY_NAME } from "../lib/brand";
import { captureException } from "../lib/sentry.server";
import {
  getDashboardStats,
  getRecentActivity,
  type DashboardStats,
  type ActivityItem,
} from "../lib/dashboard.server";
import { syncPendingDraftOrders } from "../lib/orders.server";
import { processBirthdayBonuses } from "../lib/bonus-rules.server";
import { backfillMissingTiers } from "../lib/tier-engine.server";
import { processPointsExpiry } from "../lib/expiry-engine.server";
import { getPointsSetupState } from "../lib/points-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);
  const setup = await getPointsSetupState(store.id);

  try {
    // Wait until rates are saved on Program so draft sync doesn't award at default 1:1 by surprise.
    if (setup.setupCompletedAt) {
      await syncPendingDraftOrders({ admin, store, limit: 25 });
    }
    await processBirthdayBonuses(store.id);
    await processPointsExpiry(store.id);
    await backfillMissingTiers({
      storeId: store.id,
      shopDomain: store.shop_domain,
      limit: 50,
    });
  } catch (error) {
    captureException(error, {
      scope: "dashboard.sideEffects",
      shop: session.shop,
    });
  }

  let stats: DashboardStats | null = null;
  let activity: ActivityItem[] = [];

  try {
    [stats, activity] = await Promise.all([
      getDashboardStats(store.id),
      getRecentActivity(store.id, 10),
    ]);
  } catch (error) {
    captureException(error, {
      scope: "dashboard.stats",
      shop: session.shop,
    });
  }

  return {
    shop: session.shop,
    brandName: BRAND_DISPLAY_NAME,
    storeName: store.name,
    programPaused: store.program_paused,
    setupCompletedAt: setup.setupCompletedAt,
    backfillCompletedAt: setup.backfillCompletedAt,
    stats,
    activity,
  };
};

const numberFormatter = new Intl.NumberFormat("en-US");

function fmt(n: number): string {
  return numberFormatter.format(n);
}

const MOVEMENT_LABELS: Record<string, { label: string; tone: "success" | "critical" | "info" | "warning" }> = {
  earn: { label: "Earned", tone: "success" },
  redeem: { label: "Redeemed", tone: "info" },
  refund_reversal: { label: "Refund reversal", tone: "warning" },
  cancel_reversal: { label: "Cancel reversal", tone: "warning" },
  expired: { label: "Expired", tone: "critical" },
  manual: { label: "Manual", tone: "info" },
};

function StatCard({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <InlineStack gap="100" blockAlign="baseline">
          <Text as="p" variant="heading2xl">
            {value}
          </Text>
          {suffix ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {suffix}
            </Text>
          ) : null}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function TierDistribution({ stats }: { stats: DashboardStats }) {
  const total = stats.tier_distribution.reduce((s, t) => s + t.count, 0);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Tier distribution
        </Text>
        {total === 0 ? (
          <Text as="p" tone="subdued" variant="bodySm">
            —
          </Text>
        ) : (
          <BlockStack gap="300">
            {stats.tier_distribution.map((tier) => {
              const pct = total > 0 ? Math.round((tier.count / total) * 100) : 0;
              return (
                <BlockStack gap="100" key={tier.slug}>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">
                      {tier.name}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {fmt(tier.count)} ({pct}%)
                    </Text>
                  </InlineStack>
                  <ProgressBar progress={pct} size="small" tone="primary" />
                </BlockStack>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function RecentActivity({ activity }: { activity: ActivityItem[] }) {
  return (
    <Card padding="0">
      <Box padding="400">
        <Text as="h2" variant="headingMd">
          Recent activity
        </Text>
      </Box>
      {activity.length === 0 ? (
        <Box padding="400" paddingBlockStart="0">
          <Text as="p" tone="subdued" variant="bodySm">
            —
          </Text>
        </Box>
      ) : (
        <BlockStack gap="0">
          {activity.map((item) => {
            const meta = MOVEMENT_LABELS[item.movement_type] ?? {
              label: item.movement_type,
              tone: "info" as const,
            };
            const positive = item.points >= 0;
            return (
              <Box
                key={item.id}
                padding="400"
                borderBlockStartWidth="025"
                borderColor="border"
              >
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="medium">
                        {item.customer_name}
                      </Text>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {item.description ?? "—"}
                    </Text>
                  </BlockStack>
                  <Text
                    as="span"
                    variant="bodyMd"
                    fontWeight="semibold"
                    tone={positive ? "success" : "critical"}
                  >
                    {positive ? "+" : ""}
                    {fmt(item.points)}
                  </Text>
                </InlineStack>
              </Box>
            );
          })}
        </BlockStack>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  if (!data.stats) {
    return (
      <Page>
        <TitleBar title={data.brandName} />
        <BlockStack gap="400">
          <Banner tone="warning" title="Dashboard could not load">
            <p>
              Your store is connected, but stats could not be loaded right now.
              Refresh the page or try again in a moment.
            </p>
          </Banner>
        </BlockStack>
      </Page>
    );
  }

  const { stats, activity, programPaused, storeName } = data;

  return (
    <Page title="Dashboard" subtitle={storeName ?? data.shop}>
      <TitleBar title={data.brandName} />
      <BlockStack gap="400">
        {!data.setupCompletedAt ? (
          <Banner tone="warning" title="Configure points rates">
            <p>
              Go to <Link to="/app/program">Program</Link> to set earn/redeem
              rates for your shop currency, then run the 60-day order import.
              Until rates are saved, draft orders will not auto-award points.
            </p>
          </Banner>
        ) : !data.backfillCompletedAt ? (
          <Banner tone="info" title="Import historical orders">
            <p>
              Rates are saved. On <Link to="/app/program">Program</Link>, run
              &quot;Import last 60 days of orders&quot; so past customers get
              points.
            </p>
          </Banner>
        ) : null}
        {programPaused ? (
          <Banner tone="warning" title="Program paused">
            <p>Point earning for new orders is currently disabled.</p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                <StatCard label="Total members" value={fmt(stats.total_members)} />
                <StatCard label="Active members" value={fmt(stats.active_members)} suffix="with orders" />
                <StatCard label="Points issued" value={fmt(stats.points_earned)} />
                <StatCard label="Redeemed/refunded" value={fmt(stats.points_redeemed)} />
              </InlineGrid>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Net points in circulation
                  </Text>
                  <Text as="p" variant="heading2xl" tone="success">
                    {fmt(stats.net_points)}
                  </Text>
                </BlockStack>
              </Card>

              <RecentActivity activity={activity} />
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <TierDistribution stats={stats} />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
