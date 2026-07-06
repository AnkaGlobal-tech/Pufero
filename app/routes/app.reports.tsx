import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useCallback, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Button,
  Banner,
  Badge,
  Box,
  Divider,
  List,
  TextField,
  Tabs,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import {
  exportLedgerCsv,
  getJudgeMeSettings,
  getMonthlyReport,
  getProgramHealth,
  getRoiMetrics,
  parseYearMonth,
  regenerateJudgeMeToken,
  type MonthlyReport,
  type ProgramHealth,
  type RoiMetrics,
} from "../lib/reports.server";

const MONTHS = [
  { label: "January", value: "1" },
  { label: "February", value: "2" },
  { label: "March", value: "3" },
  { label: "April", value: "4" },
  { label: "May", value: "5" },
  { label: "June", value: "6" },
  { label: "July", value: "7" },
  { label: "August", value: "8" },
  { label: "September", value: "9" },
  { label: "October", value: "10" },
  { label: "November", value: "11" },
  { label: "December", value: "12" },
];

function yearOptions(): { label: string; value: string }[] {
  const current = new Date().getUTCFullYear();
  return Array.from({ length: 4 }, (_, i) => {
    const y = String(current - i);
    return { label: y, value: y };
  });
}

const fmt = new Intl.NumberFormat("en-US");
const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const fmtPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return json({ missingStore: true as const });
  }

  const url = new URL(request.url);
  const { year, month } = parseYearMonth(
    url.searchParams.get("year"),
    url.searchParams.get("month"),
  );

  if (url.searchParams.get("export") === "csv") {
    const csv = await exportLedgerCsv({ storeId: store.id, year, month });
    const filename = `anka-ledger-${year}-${String(month).padStart(2, "0")}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const appUrl = process.env.SHOPIFY_APP_URL || "https://anka-loyalty-production.up.railway.app";

  const [report, health, judgeme] = await Promise.all([
    getMonthlyReport(store.id, year, month),
    getProgramHealth(store.id),
    getJudgeMeSettings({
      storeId: store.id,
      appUrl,
      shopDomain: session.shop,
    }),
  ]);

  const roi = await getRoiMetrics(store.id, report);

  return json({
    missingStore: false as const,
    year,
    month,
    report,
    roi,
    health,
    judgeme,
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);
  if (!store) {
    return json({ ok: false, error: "Store not found" });
  }

  const form = await request.formData();
  if (form.get("intent") !== "regenerate_judgeme_token") {
    return json({ ok: false, error: "Unknown action" });
  }

  await regenerateJudgeMeToken(store.id);
  return json({ ok: true, intent: "regenerate_judgeme_token" });
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </Box>
  );
}

function PerformanceTab({
  report,
  roi,
  year,
  month,
}: {
  report: MonthlyReport;
  roi: RoiMetrics;
  year: number;
  month: number;
}) {
  const [, setSearchParams] = useSearchParams();
  const [yearState, setYearState] = useState(String(year));
  const [monthState, setMonthState] = useState(String(month));

  const applyPeriod = useCallback(() => {
    setSearchParams({ year: yearState, month: monthState, tab: "0" });
  }, [monthState, setSearchParams, yearState]);

  const csvHref = `/app/reports?year=${year}&month=${month}&export=csv`;

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Period
          </Text>
          <InlineStack gap="300" wrap blockAlign="end">
            <Box minWidth="140px">
              <Select
                label="Year"
                options={yearOptions()}
                value={yearState}
                onChange={setYearState}
              />
            </Box>
            <Box minWidth="160px">
              <Select
                label="Month"
                options={MONTHS}
                value={monthState}
                onChange={setMonthState}
              />
            </Box>
            <Button onClick={applyPeriod}>Apply</Button>
            <Button url={csvHref} download>
              Export CSV
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      <InlineStack gap="300" wrap>
        <Metric label="New members" value={fmt.format(report.new_members)} />
        <Metric label="Active members" value={fmt.format(report.active_members)} />
        <Metric label="Points earned" value={fmt.format(report.points_earned)} />
        <Metric label="Points redeemed" value={fmt.format(report.points_redeemed)} />
      </InlineStack>

      <InlineStack gap="300" wrap>
        <Metric label="Referral points" value={fmt.format(report.referral_points)} />
        <Metric label="Review points" value={fmt.format(report.review_points)} />
        <Metric
          label="Orders with points"
          value={fmt.format(report.orders_with_points)}
        />
      </InlineStack>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            ROI snapshot
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Estimates use your points-to-dollar ratio ({fmt.format(roi.pointsToDollarRatio)}{" "}
            pts = $1). Liability is total outstanding points across all members.
          </Text>
          <InlineStack gap="300" wrap>
            <Metric
              label="Redemption value (period)"
              value={fmtUsd.format(roi.redemptionValueUsd)}
            />
            <Metric label="Redemption rate" value={fmtPct.format(roi.redemptionRate)} />
            <Metric
              label="Outstanding liability"
              value={fmtUsd.format(roi.liabilityUsd)}
            />
            <Metric
              label="Outstanding points"
              value={fmt.format(roi.outstandingPoints)}
            />
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function HealthTab({ health }: { health: ProgramHealth }) {
  const issues =
    health.negative_balance_count +
    health.duplicate_source_ids.length +
    health.failed_webhooks_7d +
    health.stuck_webhooks;

  return (
    <BlockStack gap="400">
      {issues === 0 ? (
        <Banner tone="success" title="No issues detected">
          <p>Ledger, webhook queue, and balance checks look healthy.</p>
        </Banner>
      ) : (
        <Banner tone="warning" title="Review recommended">
          <p>
            {issues} potential issue{issues === 1 ? "" : "s"} found. Details below.
          </p>
        </Banner>
      )}

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Edge-case scan
            </Text>
            <Badge tone={issues === 0 ? "success" : "warning"}>
              {issues === 0 ? "Healthy" : `${issues} flags`}
            </Badge>
          </InlineStack>

          <List type="bullet">
            <List.Item>
              Negative balances:{" "}
              <strong>{fmt.format(health.negative_balance_count)}</strong> customers
            </List.Item>
            <List.Item>
              Failed webhooks (7 days):{" "}
              <strong>{fmt.format(health.failed_webhooks_7d)}</strong>
            </List.Item>
            <List.Item>
              Stuck processing webhooks (&gt;1h):{" "}
              <strong>{fmt.format(health.stuck_webhooks)}</strong>
            </List.Item>
            <List.Item>
              Duplicate ledger source IDs:{" "}
              <strong>{fmt.format(health.duplicate_source_ids.length)}</strong>
            </List.Item>
          </List>

          {health.duplicate_source_ids.length > 0 && (
            <>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">
                Duplicate source_id rows (possible double webhook or retry overlap):
              </Text>
              <List type="bullet">
                {health.duplicate_source_ids.map((row) => (
                  <List.Item key={`${row.source_id}-${row.movement_type}`}>
                    {row.source_id} · {row.movement_type} · {row.cnt} rows
                  </List.Item>
                ))}
              </List>
            </>
          )}

          <Divider />
          <Text as="p" variant="bodySm" tone="subdued">
            Shopify webhooks are deduped via <code>X-Shopify-Webhook-Id</code>. Concurrent
            redemptions rely on balance checks before deduct — customers with negative
            balances appear in the Customers filter.
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function JudgeMeTab({
  judgeme,
  shop,
}: {
  judgeme: { webhookUrl: string; connectedAt: string | null; webhookToken: string };
  shop: string;
}) {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const copying = navigation.state !== "idle";

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(judgeme.webhookUrl);
      shopify.toast.show("Webhook URL copied");
    } catch {
      shopify.toast.show("Could not copy URL", { isError: true });
    }
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Judge.me
            </Text>
            <Badge tone={judgeme.connectedAt ? "success" : undefined}>
              {judgeme.connectedAt ? "Webhook received" : "Not connected yet"}
            </Badge>
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            Award review points when Judge.me publishes a review. Text and photo rules
            are configured under Program → Earning Rules.
          </Text>

          <TextField
            label="Webhook URL"
            value={judgeme.webhookUrl}
            readOnly
            autoComplete="off"
            connectedRight={<Button onClick={copyUrl}>Copy</Button>}
          />

          <List type="number">
            <List.Item>
              In Judge.me → Settings → Integrations → Webhooks, add a webhook.
            </List.Item>
            <List.Item>
              Event: <strong>review/published</strong> (or review/created).
            </List.Item>
            <List.Item>Paste the URL above. Judge.me sends <code>shop_domain</code> — we verify it matches {shop}.</List.Item>
            <List.Item>
              Reviewer email must match a loyalty member (same email as Shopify customer).
            </List.Item>
          </List>

          <Form method="post">
            <input type="hidden" name="intent" value="regenerate_judgeme_token" />
            <Button submit loading={copying} variant="plain" tone="critical">
              Regenerate webhook token
            </Button>
          </Form>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = Number.parseInt(searchParams.get("tab") ?? "0", 10) || 0;

  if (data.missingStore) {
    return (
      <Page>
        <TitleBar title="Reports" />
        <Banner tone="warning">Store record not found. Reinstall the app.</Banner>
      </Page>
    );
  }

  const tabs = [
    { id: "performance", content: "Performance" },
    { id: "health", content: "Program health" },
    { id: "judgeme", content: "Judge.me" },
  ];

  return (
    <Page>
      <TitleBar title="Reports" />
      <Layout>
        <Layout.Section>
          <Tabs
            tabs={tabs}
            selected={tab}
            onSelect={(index) => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("tab", String(index));
                return next;
              });
            }}
          >
            <Box paddingBlockStart="400">
              {tab === 0 && (
                <PerformanceTab
                  report={data.report}
                  roi={data.roi}
                  year={data.year}
                  month={data.month}
                />
              )}
              {tab === 1 && <HealthTab health={data.health} />}
              {tab === 2 && (
                <JudgeMeTab judgeme={data.judgeme} shop={data.shop} />
              )}
            </Box>
          </Tabs>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
