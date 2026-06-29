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
import { getStoreByDomain } from "../lib/store.server";
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
  const store = await getStoreByDomain(session.shop);
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
  const store = await getStoreByDomain(session.shop);
  const customerId = params.id;

  if (!store || !customerId) {
    return { ok: false as const, error: "Mağaza veya müşteri bulunamadı." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "set_tier") {
    const tierIdRaw = String(form.get("tier_id") ?? "");
    const tierId = tierIdRaw === "auto" ? null : tierIdRaw;

    if (tierId !== null && !tierId) {
      return { ok: false as const, error: "Tier seçin." };
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
        error: error instanceof Error ? error.message : "Bilinmeyen hata",
      };
    }
  }

  if (intent === "redeem") {
    const redemptionId = String(form.get("redemption_id") ?? "");
    if (!redemptionId) {
      return { ok: false as const, error: "Kupon kademesi seçin." };
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
        error: error instanceof Error ? error.message : "Bilinmeyen hata",
      };
    }
  }

  if (intent !== "manual_points") {
    return { ok: false as const, error: "Bilinmeyen işlem." };
  }

  const direction = String(form.get("direction"));
  const amountRaw = Number(form.get("amount"));
  const reason = String(form.get("reason") ?? "").trim();

  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return { ok: false as const, error: "Geçerli bir puan miktarı girin." };
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
      error: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }

  return { ok: true as const, intent: "manual_points" as const, points: signed };
};

const numberFormatter = new Intl.NumberFormat("tr-TR");
const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const MOVEMENT_LABELS: Record<
  LedgerMovementType,
  { label: string; tone: "success" | "info" | "warning" | "critical" | "attention" }
> = {
  earn: { label: "Kazanım", tone: "success" },
  redeem: { label: "Harcama", tone: "info" },
  refund_reversal: { label: "İade geri alımı", tone: "warning" },
  cancel_reversal: { label: "İptal geri alımı", tone: "warning" },
  expired: { label: "Süresi doldu", tone: "critical" },
  manual: { label: "Manuel", tone: "attention" },
};

const SOURCE_LABELS: Record<LedgerSource, string> = {
  purchase: "Satın alma",
  review_text: "Yazılı yorum",
  review_photo: "Fotoğraflı yorum",
  ugc_video: "UGC video",
  referral: "Referral",
  manual: "Manuel",
  campaign: "Kampanya",
  birthday: "Doğum günü",
  account_creation: "Hesap oluşturma",
  first_order_bonus: "İlk sipariş bonusu",
  second_order_bonus: "2. sipariş bonusu",
  third_order_bonus: "3. sipariş bonusu",
  bulk_order_bonus: "Bulk sipariş bonusu",
};

function customerName(c: CustomerDetail): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || "İsimsiz müşteri";
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
            Özet
          </Text>
          <InlineStack gap="200">
            {customer.tier_name ? (
              <Badge tone="info">{customer.tier_name}</Badge>
            ) : null}
            {customer.tier_manual_override ? (
              <Badge tone="attention">Manuel tier</Badge>
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
              Puan Bakiyesi
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
              Toplam Harcama
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="medium" numeric>
              ${currencyFormatter.format(customer.total_spend)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Sipariş Sayısı
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="medium" numeric>
              {numberFormatter.format(customer.order_count)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Üyelik
            </Text>
            <Text as="span" variant="bodyMd">
              {formatDate(customer.created_at)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Son Aktivite
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
    { label: "Otomatik (harcamaya göre)", value: "auto" },
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
              Tier seçimi Shopify müşteri tag&apos;ini günceller. Mevcut tag:{" "}
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
              Tier kaydet
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
            Puan Harcama
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Aktif kupon kademesi yok. Program → Redemption bölümünden kademe
            açın.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const options = redemptions.map((r) => ({
    label: `${r.name} (${numberFormatter.format(r.points_cost)} puan)`,
    value: r.id,
  }));

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="redeem" />
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Puan Harcama
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Bakiye: {numberFormatter.format(customer.balance)} puan. Tek
              kullanımlık müşteriye özel kupon üretilir.
            </Text>
          </BlockStack>

          {actionData && !actionData.ok ? (
            <Banner tone="critical">{actionData.error}</Banner>
          ) : null}

          {actionData?.ok && actionData.intent === "redeem" ? (
            <Banner tone="success" title="Kupon oluşturuldu">
              <p>
                <strong>{actionData.redeem.code}</strong> —{" "}
                {actionData.redeem.redemptionName} (
                {numberFormatter.format(actionData.redeem.pointsDeducted)} puan
                düşüldü)
              </p>
            </Banner>
          ) : null}

          <Select
            label="Kademe"
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
              Kupon üret
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
              Manuel Puan
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Müşteriye elle puan ekleyin veya düşün. Hareket geçmişe
              "Manuel" olarak işlenir.
            </Text>
          </BlockStack>

          {actionData && !actionData.ok ? (
            <Banner tone="critical">{actionData.error}</Banner>
          ) : null}

          <Select
            label="İşlem"
            options={[
              { label: "Puan ekle (+)", value: "add" },
              { label: "Puan düş (−)", value: "subtract" },
            ]}
            value={direction}
            onChange={setDirection}
          />
          <TextField
            label="Miktar"
            type="number"
            name="amount"
            value={amount}
            onChange={setAmount}
            autoComplete="off"
            min={1}
            step={1}
            suffix="puan"
            requiredIndicator
          />
          <TextField
            label="Açıklama (opsiyonel)"
            name="reason"
            value={reason}
            onChange={setReason}
            autoComplete="off"
            multiline={2}
            placeholder="Örn. müşteri hizmetleri telafisi"
          />
          <InlineStack align="end">
            <Button
              submit
              variant="primary"
              tone={direction === "subtract" ? "critical" : undefined}
              loading={submitting}
              disabled={disabled || amount.trim() === ""}
            >
              Uygula
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
          heading="Henüz puan hareketi yok"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Sipariş, manuel düzeltme veya bonuslar burada listelenecek.</p>
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
                ? `Sipariş #${entry.shopify_order_id}`
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
          { title: "Tarih" },
          { title: "Tür" },
          { title: "Kaynak" },
          { title: "Açıklama" },
          { title: "Puan", alignment: "end" },
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
      shopify.toast.show("Puan güncellendi");
    }
    if (actionData.intent === "set_tier") {
      shopify.toast.show(`Tier: ${actionData.tierName}`);
    }
    if (actionData.intent === "redeem") {
      shopify.toast.show(`Kupon: ${actionData.redeem.code}`);
    }
  }, [actionData, navigation.state, shopify]);

  if (!data.found) {
    return (
      <Page title="Müşteri" backAction={{ content: "Müşteriler", url: "/app/customers" }}>
        <TitleBar title="Müşteri" />
        <Banner tone="critical" title="Müşteri bulunamadı">
          <p>Bu müşteri kaydı mevcut değil veya bu mağazaya ait değil.</p>
        </Banner>
      </Page>
    );
  }

  const { customer, ledger, tiers, redemptions } = data;

  return (
    <Page
      title={customerName(customer)}
      subtitle={customer.email ?? undefined}
      backAction={{ content: "Müşteriler", url: "/app/customers" }}
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
              Puan Geçmişi
            </Text>
            <LedgerCard ledger={ledger} />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
