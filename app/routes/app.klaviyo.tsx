import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Banner,
  Badge,
  List,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrEnsureStoreByDomain } from "../lib/store.server";
import {
  loadKlaviyoSettings,
  saveKlaviyoSettings,
  maskApiKey,
} from "../lib/klaviyo-settings.server";
import { testKlaviyoConnection } from "../lib/klaviyo-api.server";
import {
  countPendingKlaviyoEvents,
  flushPendingKlaviyoEvents,
} from "../lib/klaviyo-sync.server";
import {
  backfillRecentOrders,
  getRecentMemberStats,
  sendWelcomeCampaign,
} from "../lib/klaviyo-backfill.server";
import { KLAVIYO_METRICS, KLAVIYO_FLOW_GUIDE, KLAVIYO_PROFILE_KEYS } from "../lib/klaviyo-constants";

const FLOW_GUIDE = KLAVIYO_FLOW_GUIDE;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);

  const settings = await loadKlaviyoSettings(store.id);
  const [pending, recentStats] = await Promise.all([
    countPendingKlaviyoEvents(store.id),
    getRecentMemberStats(store.id),
  ]);

  if (settings?.apiKey) {
    await flushPendingKlaviyoEvents(store.id, 25);
  }

  return json({
    connected: Boolean(settings?.apiKey),
    maskedKey: settings ? maskApiKey(settings.apiKey) : null,
    connectedAt: settings?.connectedAt ?? null,
    backfillCompletedAt: settings?.backfillCompletedAt ?? null,
    welcomeSentAt: settings?.welcomeSentAt ?? null,
    pending,
    recentStats,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "connect") {
      const apiKey = String(form.get("api_key") ?? "").trim();
      if (!apiKey) {
        return json({ ok: false, error: "Enter your Klaviyo private API key." });
      }

      await testKlaviyoConnection(apiKey);

      const existing = await loadKlaviyoSettings(store.id);
      await saveKlaviyoSettings(store.id, {
        apiKey,
        connectedAt: new Date().toISOString(),
        backfillCompletedAt: existing?.backfillCompletedAt ?? null,
        welcomeSentAt: existing?.welcomeSentAt ?? null,
      });

      return redirect("/app/klaviyo?connected=1");
    }

    if (intent === "disconnect") {
      await saveKlaviyoSettings(store.id, {
        apiKey: "",
        connectedAt: null,
        backfillCompletedAt: null,
        welcomeSentAt: null,
      });
      return redirect("/app/klaviyo");
    }

    if (intent === "backfill_orders") {
      const result = await backfillRecentOrders({ admin, store, days: 60 });
      return json({ ok: true, intent, result });
    }

    if (intent === "send_welcome") {
      const result = await sendWelcomeCampaign({ storeId: store.id, days: 60 });
      await flushPendingKlaviyoEvents(store.id, 100);
      return json({ ok: true, intent, result });
    }

    if (intent === "flush_queue") {
      const result = await flushPendingKlaviyoEvents(store.id, 100);
      return json({ ok: true, intent, flush: result });
    }

    return json({ ok: false, error: "Unknown action." });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Action failed.",
      intent,
    });
  }
};

export default function KlaviyoPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [apiKey, setApiKey] = useState("");
  const busy = navigation.state !== "idle";

  return (
    <Page title="Klaviyo">
      <TitleBar title="Klaviyo" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.connected ? (
              <Banner tone="success" title="Klaviyo connected">
                <p>
                  API key: {data.maskedKey}
                  {data.connectedAt
                    ? ` · Connected ${new Date(data.connectedAt).toLocaleDateString()}`
                    : ""}
                </p>
              </Banner>
            ) : (
              <Banner tone="info" title="Connect Klaviyo to email your members">
                <p>
                  Use Klaviyo flows triggered by Loyalty events. Profile
                  properties <code>{KLAVIYO_PROFILE_KEYS.pointsBalance}</code> and{" "}
                  <code>{KLAVIYO_PROFILE_KEYS.tier}</code> stay in sync automatically.
                </p>
              </Banner>
            )}

            {actionData && !actionData.ok ? (
              <Banner tone="critical" title="Error">
                <p>{actionData.error}</p>
              </Banner>
            ) : null}

            {actionData?.ok && actionData.intent === "backfill_orders" ? (
              <Banner tone="success" title="60-day order backfill complete">
                <p>
                  Scanned {actionData.result.scanned} orders · Awarded{" "}
                  {actionData.result.awarded} · Skipped{" "}
                  {actionData.result.skipped}
                  {actionData.result.errors.length > 0
                    ? ` · ${actionData.result.errors.length} errors`
                    : ""}
                </p>
              </Banner>
            ) : null}

            {actionData?.ok && actionData.intent === "send_welcome" ? (
              <Banner tone="success" title="Welcome events sent to Klaviyo">
                <p>
                  Targeted {actionData.result.targeted} members · Events sent{" "}
                  {actionData.result.sent} · Skipped {actionData.result.skipped}
                </p>
                <p>
                  Create a flow in Klaviyo triggered by &quot;
                  {KLAVIYO_METRICS.welcome}&quot; to send the launch emails.
                </p>
              </Banner>
            ) : null}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  1. Connect API key
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Klaviyo → Settings → API Keys → Create Private API Key with{" "}
                  <strong>events:write</strong> and <strong>profiles:write</strong>.
                </Text>
                {!data.connected ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="connect" />
                    <BlockStack gap="300">
                      <TextField
                        label="Private API key"
                        name="api_key"
                        value={apiKey}
                        onChange={setApiKey}
                        autoComplete="off"
                        type="password"
                      />
                      <Button submit loading={busy}>
                        Connect Klaviyo
                      </Button>
                    </BlockStack>
                  </Form>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <Button submit tone="critical" variant="plain" loading={busy}>
                      Disconnect
                    </Button>
                  </Form>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    2. Import last 60 days of orders
                  </Text>
                  {data.backfillCompletedAt ? (
                    <Badge tone="success">Done</Badge>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Awards loyalty points for paid orders from the last 60 days
                  (idempotent — safe to run again). Do this before the welcome
                  campaign so balances are correct.
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="backfill_orders" />
                  <Button submit loading={busy} disabled={!data.connected}>
                    Run 60-day order backfill
                  </Button>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    3. Launch welcome emails
                  </Text>
                  {data.welcomeSentAt ? (
                    <Badge tone="success">Sent</Badge>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Sends <strong>{KLAVIYO_METRICS.welcome}</strong> to{" "}
                  {data.recentStats.withEmail} members active in the last 60 days
                  (of {data.recentStats.memberCount} total). Each event includes
                  current balance, tier, and earning hints (review/referral points).
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="send_welcome" />
                  <Button
                    submit
                    variant="primary"
                    loading={busy}
                    disabled={!data.connected}
                  >
                    Send welcome events to Klaviyo
                  </Button>
                </Form>
                <Text as="p" variant="bodySm" tone="subdued">
                  Then in Klaviyo: Flows → Create flow → Metric trigger → choose
                  &quot;{KLAVIYO_METRICS.welcome}&quot; → design your email with{" "}
                  {"{{ person." + KLAVIYO_PROFILE_KEYS.pointsBalance + " }}"} or event properties.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Queue &amp; profile sync
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pending events: {data.pending}. New earns/redeems/reviews push
                  automatically when Klaviyo is connected.
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="flush_queue" />
                  <Button submit loading={busy} disabled={!data.connected}>
                    Sync pending events
                  </Button>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Flow ideas (create in Klaviyo)
                </Text>
                <List type="bullet">
                  {FLOW_GUIDE.map((flow) => (
                    <List.Item key={flow.metric}>
                      <strong>{flow.title}</strong> — trigger:{" "}
                      <code>{flow.metric}</code>. {flow.body}
                    </List.Item>
                  ))}
                </List>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Profile properties synced on every event: {KLAVIYO_PROFILE_KEYS.pointsBalance},
                  {KLAVIYO_PROFILE_KEYS.tier}, {KLAVIYO_PROFILE_KEYS.tierSlug},{" "}
                  {KLAVIYO_PROFILE_KEYS.member}, {KLAVIYO_PROFILE_KEYS.memberSince}.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
