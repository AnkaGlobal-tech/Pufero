import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Badge,
  Banner,
  Button,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import {
  awardDraftOrderPoints,
  awardOrderPoints,
  fetchDraftOrders,
  fetchRecentOrders,
  syncPendingDraftOrders,
  type DraftOrderRow,
  type OrderRow,
} from "../lib/orders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return { missingStore: true as const };
  }

  await syncPendingDraftOrders({ admin, store, limit: 25 });

  const [{ orders }, drafts] = await Promise.all([
    fetchRecentOrders({ admin, storeId: store.id, limit: 25 }),
    fetchDraftOrders({ admin, storeId: store.id, limit: 15 }),
  ]);

  return { missingStore: false as const, orders, drafts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return { ok: false as const, error: "Mağaza bulunamadı." };
  }

  const form = await request.formData();
  const draftId = Number(form.get("draft_id"));
  const orderId = Number(form.get("order_id"));

  if (Number.isFinite(draftId) && draftId > 0) {
    const drafts = await fetchDraftOrders({ admin, storeId: store.id, limit: 50 });
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) {
      return { ok: false as const, error: "Taslak sipariş bulunamadı." };
    }
    const result = await awardDraftOrderPoints({ store, draft });
    if (!result.ok) {
      return result;
    }
    return { ok: true as const, draftId, points: result.points };
  }

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return { ok: false as const, error: "Geçersiz sipariş." };
  }

  const result = await awardOrderPoints({ admin, store, orderId });
  if (!result.ok) {
    return result;
  }

  return { ok: true as const, orderId, points: result.points };
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

const DRAFT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Açık",
  INVOICE_SENT: "Fatura gönderildi",
  COMPLETED: "Tamamlandı",
};

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter.format(d);
}

function PointsStatusBadge({ order }: { order: OrderRow }) {
  switch (order.pointsStatus) {
    case "awarded":
      return (
        <Badge tone="success">
          {order.pointsAwarded != null
            ? `+${numberFormatter.format(order.pointsAwarded)} puan`
            : "Verildi"}
        </Badge>
      );
    case "pending":
      return <Badge tone="attention">Bekliyor</Badge>;
    case "guest":
      return <Badge tone="info">Misafir</Badge>;
    case "cancelled":
      return <Badge tone="critical">İptal</Badge>;
  }
}

function OrdersTable({
  orders,
  submittingOrderId,
}: {
  orders: OrderRow[];
  submittingOrderId: number | null;
}) {
  if (orders.length === 0) {
    return (
      <Card>
        <Text as="p" variant="bodyMd" tone="subdued">
          Sipariş yok
        </Text>
      </Card>
    );
  }

  const rows = orders.map((order, index) => (
    <IndexTable.Row id={String(order.id)} key={order.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="medium">
          {order.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodySm">
            {order.customerName ?? "—"}
          </Text>
          {order.customerEmail ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {order.customerEmail}
            </Text>
          ) : null}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric>
          ${currencyFormatter.format(order.subtotal)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(order.createdAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <PointsStatusBadge order={order} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric tone="subdued">
          {order.pointsStatus === "pending" || order.pointsStatus === "awarded"
            ? numberFormatter.format(
                order.pointsAwarded ?? order.estimatedPoints,
              )
            : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {order.pointsStatus === "pending" ? (
          <Form method="post">
            <input type="hidden" name="order_id" value={order.id} />
            <Button
              submit
              size="slim"
              loading={submittingOrderId === order.id}
            >
              Puan ver
            </Button>
          </Form>
        ) : (
          <Text as="span" tone="subdued">
            —
          </Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Card padding="0">
      <IndexTable
        itemCount={orders.length}
        selectable={false}
        headings={[
          { title: "Sipariş" },
          { title: "Müşteri" },
          { title: "Ara toplam" },
          { title: "Tarih" },
          { title: "Puan durumu" },
          { title: "Puan" },
          { title: "İşlem" },
        ]}
      >
        {rows}
      </IndexTable>
    </Card>
  );
}

function DraftPointsStatusBadge({ draft }: { draft: DraftOrderRow }) {
  switch (draft.pointsStatus) {
    case "awarded":
      return (
        <Badge tone="success">
          {draft.pointsAwarded != null
            ? `+${numberFormatter.format(draft.pointsAwarded)} puan`
            : "Verildi"}
        </Badge>
      );
    case "pending":
      return <Badge tone="attention">Bekliyor</Badge>;
    case "guest":
      return <Badge tone="info">Misafir</Badge>;
    default:
      return <Badge tone="info">{draft.status}</Badge>;
  }
}

function DraftOrdersTable({
  drafts,
  submittingDraftId,
}: {
  drafts: DraftOrderRow[];
  submittingDraftId: number | null;
}) {
  if (drafts.length === 0) {
    return (
      <Card>
        <Text as="p" variant="bodyMd" tone="subdued">
          Taslak sipariş yok
        </Text>
      </Card>
    );
  }

  const rows = drafts.map((draft, index) => (
    <IndexTable.Row id={String(draft.id)} key={draft.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="medium">
          {draft.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodySm">
            {draft.customerName ?? "—"}
          </Text>
          {draft.customerEmail ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {draft.customerEmail}
            </Text>
          ) : null}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric>
          ${currencyFormatter.format(draft.subtotal)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{DRAFT_STATUS_LABELS[draft.status] ?? draft.status}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <DraftPointsStatusBadge draft={draft} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric tone="subdued">
          {draft.pointsStatus === "pending" || draft.pointsStatus === "awarded"
            ? numberFormatter.format(
                draft.pointsAwarded ?? draft.estimatedPoints,
              )
            : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(draft.updatedAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {draft.pointsStatus === "pending" ? (
          <Form method="post">
            <input type="hidden" name="draft_id" value={draft.id} />
            <Button
              submit
              size="slim"
              loading={submittingDraftId === draft.id}
            >
              Puan ver
            </Button>
          </Form>
        ) : (
          <Text as="span" tone="subdued">
            —
          </Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Card padding="0">
      <IndexTable
        itemCount={drafts.length}
        selectable={false}
        headings={[
          { title: "Taslak" },
          { title: "Müşteri" },
          { title: "Ara toplam" },
          { title: "Durum" },
          { title: "Puan durumu" },
          { title: "Puan" },
          { title: "Güncelleme" },
          { title: "İşlem" },
        ]}
      >
        {rows}
      </IndexTable>
    </Card>
  );
}

export default function OrdersPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const submittingOrderId =
    navigation.state === "submitting" && navigation.formData?.get("order_id")
      ? Number(navigation.formData.get("order_id"))
      : null;

  const submittingDraftId =
    navigation.state === "submitting" && navigation.formData?.get("draft_id")
      ? Number(navigation.formData.get("draft_id"))
      : null;

  useEffect(() => {
    if (!actionData || navigation.state !== "idle") return;
    if (actionData.ok) {
      shopify.toast.show(
        `+${numberFormatter.format(actionData.points)} puan verildi`,
      );
    } else {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, navigation.state, shopify]);

  if (data.missingStore) {
    return (
      <Page title="Siparişler">
        <TitleBar title="Siparişler" />
        <Banner tone="critical" title="Mağaza kaydı bulunamadı" />
      </Page>
    );
  }

  const { orders, drafts } = data;

  return (
    <Page title="Siparişler">
      <TitleBar title="Siparişler" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Siparişler
            </Text>
            <OrdersTable
              orders={orders}
              submittingOrderId={
                Number.isFinite(submittingOrderId) ? submittingOrderId : null
              }
            />

            <Text as="h2" variant="headingMd">
              Taslak siparişler
            </Text>
            <DraftOrdersTable
              drafts={drafts}
              submittingDraftId={
                Number.isFinite(submittingDraftId) ? submittingDraftId : null
              }
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
