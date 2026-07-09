import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Button,
  Badge,
  Banner,
  Box,
  IndexTable,
  EmptyState,
  InlineGrid,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrEnsureStoreByDomain } from "../lib/store.server";
import {
  addManualPoints,
  getCustomerDetail,
  getCustomerLedger,
  setCustomerTier,
} from "../lib/customers.server";
import type { CustomerDetail, LedgerEntry } from "../lib/customers.server";
import { listStoreTiers } from "../lib/tier-engine.server";
import {
  listEnabledRedemptions,
  redeemPointsForCustomer,
} from "../lib/redemption.server";
import type { RedemptionTier } from "../lib/redemption.server";
import type { StoreTierOption } from "../lib/tier-engine.server";
import type { LedgerMovementType, LedgerSource } from "../types/loyalty";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);
  const customerId = params.id;

  if (!store || !customerId) {
    return { found: false as const };
  }

  const customer = await getCustomerDetail(store.id, customerId);
  if (!customer) {
    return { found: false as const };
  }

  const ledger = await getCustomerLedger(store.id, customerId, 100);
  const [tiers, redemptions] = await Promise.all([
    listStoreTiers(store.id),
    listEnabledRedemptions(store.id),
  ]);
  return { found: true as const, customer, ledger, tiers, redemptions };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);
  const customerId = params.id;

  if (!store || !customerId) {
    return { ok: false as const, error: "Store or customer not found." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "set_tier") {
    const tierIdRaw = String(form.get("tier_id") ?? "");
    const tierId = tierIdRaw === "auto" ? null : tierIdRaw;

    if (tierId !== null && !tierId) {
      return { ok: false as const, error: "Select a tier." };
    }

    try {
      const result = await setCustomerTier({
        storeId: store.id,
        customerId,
        shopDomain: store.shop_domain,
        tierId,
      });
      return {
        ok: true as const,
        intent: "set_tier" as const,
        tierName: result.tierName,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  if (intent === "redeem") {
    const redemptionId = String(form.get("redemption_id") ?? "");
    if (!redemptionId) {
      return { ok: false as const, error: "Select a redemption tier." };
    }

    try {
      const result = await redeemPointsForCustomer({
        storeId: store.id,
        customerId,
        redemptionId,
        shopDomain: store.shop_domain,
      });
      return {
        ok: true as const,
        intent: "redeem" as const,
        redeem: result,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  if (intent !== "manual_points") {
    return { ok: false as const, error: "Unknown action." };
  }

  const direction = String(form.get("direction"));
  const amountRaw = Number(form.get("amount"));
  const reason = String(form.get("reason") ?? "").trim();

  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return { ok: false as const, error: "Enter a valid points amount." };
  }

  const amount = Math.floor(amountRaw);
  const signed = direction === "subtract" ? -amount : amount;

  try {
    await addManualPoints({
      storeId: store.id,
      customerId,
      points: signed,
      reason,
      actor: session.shop,
    });
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return { ok: true as const, intent: "manual_points" as const, points: signed };
};

const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const MOVEMENT_LABELS: Record<
  LedgerMovementType,
  { label: string; tone: "success" | "info" | "warning" | "critical" | "attention" }
> = {
  earn: { label: "Earned", tone: "success" },
  redeem: { label: "Redeemed", tone: "info" },
  refund_reversal: { label: "Refund reversal", tone: "warning" },
  cancel_reversal: { label: "Cancel reversal", tone: "warning" },
  expired: { label: "Expired", tone: "critical" },
  manual: { label: "Manual", tone: "attention" },
};

const SOURCE_LABELS: Record<LedgerSource, string> = {
  purchase: "Purchase",
  review_text: "Text review",
  review_photo: "Photo review",
  ugc_video: "UGC video",
  referral: "Referral",
  manual: "Manual",
  campaign: "Campaign",
  birthday: "Birthday",
  account_creation: "Account creation",
  first_order_bonus: "First order bonus",
  second_order_bonus: "Second order bonus",
  third_order_bonus: "Third order bonus",
  bulk_order_bonus: "Bulk order bonus",
};

function customerName(c: CustomerDetail): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || "Unnamed customer";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter.format(d);
}

function SummaryCard({ customer }: { customer: CustomerDetail }) {
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            Summary
          </Text>
          <InlineStack gap="200">
            {customer.tier_name ? (
              <Badge tone="info">{customer.tier_name}</Badge>
            ) : null}
            {customer.tier_manual_override ? (
              <Badge tone="attention">Manual tier</Badge>
            ) : null}
          </InlineStack>
        </BlockStack>

        <Box
          padding="400"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <BlockStack gap="100" inlineAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              Points balance
            </Text>
            <Text
              as="span"
              variant="heading2xl"
              numeric
              tone={customer.balance < 0 ? "critical" : undefined}
            >
              {numberFormatter.format(customer.balance)}
            </Text>
          </BlockStack>
        </Box>

        <InlineGrid columns="2" gap="300">
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Total spend
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="medium" numeric>
              ${currencyFormatter.format(customer.total_spend)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Order count
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="medium" numeric>
              {numberFormatter.format(customer.order_count)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Member since
            </Text>
            <Text as="span" variant="bodyMd">
              {formatDate(customer.created_at)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Last activity
            </Text>
            <Text as="span" variant="bodyMd">
              {formatDate(customer.last_activity_at)}
            </Text>
          </BlockStack>
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}

function TierCard({
  customer,
  tiers,
  disabled,
}: {
  customer: CustomerDetail;
  tiers: StoreTierOption[];
  disabled: boolean;
}) {
  const currentValue = customer.tier_manual_override
    ? customer.tier_id ?? "auto"
    : "auto";
  const [tierId, setTierId] = useState(currentValue);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const submitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "set_tier";

  useEffect(() => {
    setTierId(
      customer.tier_manual_override ? customer.tier_id ?? "auto" : "auto",
    );
  }, [customer.tier_id, customer.tier_manual_override]);

  const currentTag =
    tiers.find((t) => t.id === customer.tier_id)?.shopify_customer_tag ??
    tiers.find((t) => t.slug === customer.tier_slug)?.shopify_customer_tag;

  const options = [
    { label: "Automatic (based on spend)", value: "auto" },
    ...tiers.map((t) => ({
      label: `${t.name} → ${t.shopify_customer_tag}`,
      value: t.id,
    })),
  ];

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="set_tier" />
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              VIP Tier
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Tier selection updates the Shopify customer tag. Current tag:{" "}
              <Text as="span" fontWeight="semibold">
                {currentTag ?? "—"}
              </Text>
            </Text>
          </BlockStack>

          {actionData && !actionData.ok ? (
            <Banner tone="critical">{actionData.error}</Banner>
          ) : null}

          <Select
            label="Tier"
            name="tier_id"
            options={options}
            value={tierId}
            onChange={setTierId}
          />
          <InlineStack align="end">
            <Button submit loading={submitting} disabled={disabled}>
              Save tier
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}

function RedeemCard({
  customer,
  redemptions,
  disabled,
}: {
  customer: CustomerDetail;
  redemptions: RedemptionTier[];
  disabled: boolean;
}) {
  const [redemptionId, setRedemptionId] = useState(
    redemptions[0]?.id ?? "",
  );
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const submitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "redeem";

  if (redemptions.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Redeem points
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            No active redemption tiers. Enable tiers under Program → Redemption.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const options = redemptions.map((r) => ({
    label: `${r.name} (${numberFormatter.format(r.points_cost)} points)`,
    value: r.id,
  }));

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="redeem" />
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Redeem points
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Balance: {numberFormatter.format(customer.balance)} points. A
              single-use customer-specific coupon will be generated.
            </Text>
          </BlockStack>

          {actionData && !actionData.ok ? (
            <Banner tone="critical">{actionData.error}</Banner>
          ) : null}

          {actionData?.ok && actionData.intent === "redeem" ? (
            <Banner tone="success" title="Coupon created">
              <p>
                <strong>{actionData.redeem.code}</strong> —{" "}
                {actionData.redeem.redemptionName} (
                {numberFormatter.format(actionData.redeem.pointsDeducted)} points
                deducted)
              </p>
            </Banner>
          ) : null}

          <Select
            label="Tier"
            name="redemption_id"
            options={options}
            value={redemptionId}
            onChange={setRedemptionId}
          />
          <InlineStack align="end">
            <Button
              submit
              variant="primary"
              loading={submitting}
              disabled={disabled || customer.balance <= 0}
            >
              Generate coupon
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}

function ManualPointsCard({ disabled }: { disabled: boolean }) {
  const [direction, setDirection] = useState("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const submitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "manual_points";

  useEffect(() => {
    if (actionData?.ok) {
      setAmount("");
      setReason("");
    }
  }, [actionData]);

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="manual_points" />
        <input type="hidden" name="direction" value={direction} />
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Manual points
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Add or deduct points manually. The movement is recorded as
              &quot;Manual&quot; in the ledger.
            </Text>
          </BlockStack>

          {actionData && !actionData.ok ? (
            <Banner tone="critical">{actionData.error}</Banner>
          ) : null}

          <Select
            label="Action"
            options={[
              { label: "Add points (+)", value: "add" },
              { label: "Deduct points (−)", value: "subtract" },
            ]}
            value={direction}
            onChange={setDirection}
          />
          <TextField
            label="Amount"
            type="number"
            name="amount"
            value={amount}
            onChange={setAmount}
            autoComplete="off"
            min={1}
            step={1}
            suffix="points"
            requiredIndicator
          />
          <TextField
            label="Description (optional)"
            name="reason"
            value={reason}
            onChange={setReason}
            autoComplete="off"
            multiline={2}
            placeholder="E.g. customer service compensation"
          />
          <InlineStack align="end">
            <Button
              submit
              variant="primary"
              tone={direction === "subtract" ? "critical" : undefined}
              loading={submitting}
              disabled={disabled || amount.trim() === ""}
            >
              Apply
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}

function LedgerCard({ ledger }: { ledger: LedgerEntry[] }) {
  if (ledger.length === 0) {
    return (
      <Card>
        <EmptyState
          heading="No point activity yet"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Orders, manual adjustments, and bonuses will appear here.</p>
        </EmptyState>
      </Card>
    );
  }

  const rows = ledger.map((entry, index) => {
    const movement = MOVEMENT_LABELS[entry.movement_type] ?? {
      label: entry.movement_type,
      tone: "info" as const,
    };
    const positive = entry.points >= 0;

    return (
      <IndexTable.Row id={entry.id} key={entry.id} position={index}>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatDate(entry.created_at)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={movement.tone}>{movement.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {entry.source ? SOURCE_LABELS[entry.source] ?? entry.source : "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {entry.description ??
              (entry.shopify_order_id
                ? `Order #${entry.shopify_order_id}`
                : "—")}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text
            as="span"
            variant="bodyMd"
            fontWeight="semibold"
            numeric
            tone={positive ? "success" : "critical"}
          >
            {positive ? "+" : ""}
            {numberFormatter.format(entry.points)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Card padding="0">
      <IndexTable
        itemCount={ledger.length}
        selectable={false}
        headings={[
          { title: "Date" },
          { title: "Type" },
          { title: "Source" },
          { title: "Description" },
          { title: "Points", alignment: "end" },
        ]}
      >
        {rows}
      </IndexTable>
    </Card>
  );
}

export default function CustomerDetailPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  useEffect(() => {
    if (!actionData?.ok || navigation.state !== "idle") {
      return;
    }
    if (actionData.intent === "manual_points") {
      shopify.toast.show("Points updated");
    }
    if (actionData.intent === "set_tier") {
      shopify.toast.show(`Tier: ${actionData.tierName}`);
    }
    if (actionData.intent === "redeem") {
      shopify.toast.show(`Coupon: ${actionData.redeem.code}`);
    }
  }, [actionData, navigation.state, shopify]);

  if (!data.found) {
    return (
      <Page title="Customer" backAction={{ content: "Customers", url: "/app/customers" }}>
        <TitleBar title="Customer" />
        <Banner tone="critical" title="Customer not found">
          <p>This customer record does not exist or does not belong to this store.</p>
        </Banner>
      </Page>
    );
  }

  const { customer, ledger, tiers, redemptions } = data;

  return (
    <Page
      title={customerName(customer)}
      subtitle={customer.email ?? undefined}
      backAction={{ content: "Customers", url: "/app/customers" }}
    >
      <TitleBar title={customerName(customer)} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <SummaryCard customer={customer} />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TierCard
                customer={customer}
                tiers={tiers}
                disabled={navigation.state === "submitting"}
              />
              <RedeemCard
                customer={customer}
                redemptions={redemptions}
                disabled={navigation.state === "submitting"}
              />
            </InlineGrid>
            <ManualPointsCard disabled={navigation.state === "submitting"} />
            <Text as="h2" variant="headingMd">
              Points history
            </Text>
            <LedgerCard ledger={ledger} />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
