import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
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
import { getSupabaseAdmin } from "../lib/supabase.server";
import { processJudgeMeReviewWebhook } from "../lib/review-engine.server";

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
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "regenerate_judgeme_token") {
      await regenerateJudgeMeToken(store.id);
      return redirect("/app/reports?tab=2&judgeme=regenerated");
    }

    if (intent === "test_judgeme_webhook") {
      const email = String(form.get("test_email") ?? "").trim();
      if (!email) {
        return json({
          ok: false,
          error: "Enter a customer email that exists in your loyalty program.",
          intent,
        });
      }

      const supabase = getSupabaseAdmin();
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("store_id", store.id)
        .ilike("email", email)
        .maybeSingle();

      if (!customer) {
        return json({
          ok: false,
          error: "No loyalty member found with that email.",
          intent,
        });
      }

      const points = await processJudgeMeReviewWebhook({
        storeId: store.id,
        payload: {
          event: "review/published",
          shop_domain: session.shop,
          review: {
            id: Date.now(),
            hidden: false,
            rating: 5,
            body: "Anka Loyalty test review",
            pictures: [],
            reviewer: { email, name: "Test" },
          },
        },
      });

      return redirect(
        `/app/reports?tab=2&judgeme=test&points=${points}`,
      );
    }

    return json({ ok: false, error: "Unknown action" });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Action failed",
      intent,
    });
  }
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
  judgeme: {
    webhookUrl: string;
    connectedAt: string | null;
    webhookToken: string;
    testCurl: string;
  };
  shop: string;
}) {
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const [testEmail, setTestEmail] = useState("");
  const busy = navigation.state !== "idle";

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(judgeme.webhookUrl);
      shopify.toast.show("Webhook URL copied");
    } catch {
      shopify.toast.show("Could not copy URL", { isError: true });
    }
  };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(judgeme.testCurl);
      shopify.toast.show("Test curl copied");
    } catch {
      shopify.toast.show("Could not copy curl", { isError: true });
    }
  };

  const regenerated = searchParams.get("judgeme") === "regenerated";
  const testResult = searchParams.get("judgeme") === "test";
  const testPoints = searchParams.get("points");

  return (
    <BlockStack gap="400">
      {regenerated ? (
        <Banner tone="success" title="Webhook token regenerated">
          <p>Copy the new URL into Judge.me — the old URL will stop working.</p>
        </Banner>
      ) : null}

      {testResult ? (
        <Banner
          tone={Number(testPoints) > 0 ? "success" : "info"}
          title="Test webhook processed"
        >
          <p>
            {Number(testPoints) > 0
              ? `Awarded ${testPoints} review points. Check the customer ledger.`
              : "Webhook accepted but no points were awarded (rule disabled, duplicate test id, or program paused)."}
          </p>
        </Banner>
      ) : null}

      {actionData && !actionData.ok && actionData.intent?.includes("judgeme") ? (
        <Banner tone="critical" title="Action failed">
          <p>{actionData.error}</p>
        </Banner>
      ) : null}

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
            Judge.me supports custom outbound webhooks from the merchant dashboard
            (Settings → Integrations → Webhooks). When a review is published, Judge.me
            POSTs JSON to your URL — same pattern used by Drip, Mechanic, and other
            integrations. Text/photo point values are under Program → Earning Rules.
          </Text>

          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box minWidth="0" width="100%">
              <TextField
                label="Webhook URL"
                value={judgeme.webhookUrl}
                readOnly
                autoComplete="off"
              />
            </Box>
            <Button onClick={copyUrl}>Copy URL</Button>
          </InlineStack>

          <List type="number">
            <List.Item>
              Open the <strong>Judge.me Product Reviews</strong> app in Shopify admin.
            </List.Item>
            <List.Item>
              Go to <strong>Settings → Integrations → Webhooks</strong> (or API →
              Webhooks on some plans).
            </List.Item>
            <List.Item>
              Add webhook — event: <strong>review/published</strong> (recommended) or{" "}
              <strong>review/created</strong>.
            </List.Item>
            <List.Item>
              Paste the URL above. Payload includes <code>shop_domain</code>{" "}
              ({shop}) — we verify it matches your store.
            </List.Item>
            <List.Item>
              Reviewer email must match a loyalty member&apos;s Shopify email.
            </List.Item>
          </List>

          <Divider />

          <Text as="h3" variant="headingSm">
            Test without Judge.me
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Simulate a published review for an existing member (uses the same handler
            as the live webhook).
          </Text>
          <Form method="post">
            <input type="hidden" name="intent" value="test_judgeme_webhook" />
            <InlineStack gap="300" blockAlign="end" wrap={false}>
              <Box minWidth="280px">
                <TextField
                  label="Customer email"
                  name="test_email"
                  value={testEmail}
                  onChange={setTestEmail}
                  autoComplete="off"
                  placeholder="member@example.com"
                />
              </Box>
              <Button submit loading={busy}>
                Send test review
              </Button>
            </InlineStack>
          </Form>

          <Text as="p" variant="bodySm" tone="subdued">
            Or run from terminal (replace email with a real member):
          </Text>
          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {judgeme.testCurl}
            </pre>
          </Box>
          <Button onClick={copyCurl}>Copy test curl</Button>

          <Form method="post">
            <input type="hidden" name="intent" value="regenerate_judgeme_token" />
            <Button submit loading={busy} variant="plain" tone="critical">
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
