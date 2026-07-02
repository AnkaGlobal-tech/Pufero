import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Box,
  Banner,
  Select,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import {
  getWidgetSettingsForStore,
  updateWidgetSettings,
} from "../lib/appearance.server";
import type { WidgetSettings } from "../lib/widget-settings";
import { formatNudgeText } from "../lib/widget-settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return { missingStore: true as const };
  }

  const settings = await getWidgetSettingsForStore(store.id);
  return { missingStore: false as const, settings, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);
  if (!store) {
    return { ok: false, error: "Mağaza bulunamadı" };
  }

  const form = await request.formData();
  try {
    await updateWidgetSettings(store.id, form);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kayıt başarısız",
    };
  }

  return { ok: true };
};

function ColorField(props: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Box minWidth="160px">
      <BlockStack gap="100">
        <TextField
          label={props.label}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          autoComplete="off"
          placeholder="#C9A84C"
        />
        <input
          type="color"
          value={props.value.startsWith("#") ? props.value : "#C9A84C"}
          onChange={(e) => props.onChange(e.target.value)}
          aria-label={`${props.label} renk seçici`}
          style={{ width: "100%", height: 36, border: "none", cursor: "pointer" }}
        />
      </BlockStack>
    </Box>
  );
}

function WidgetPreview({ settings }: { settings: WidgetSettings }) {
  const sampleBalance = 1250;
  const nudge = formatNudgeText(settings.nudge_text, sampleBalance);

  return (
    <Box
      padding="400"
      borderWidth="025"
      borderColor="border"
      borderRadius="200"
      background="bg-surface-secondary"
    >
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          Önizleme (örnek bakiye: {sampleBalance} puan)
        </Text>
        <div
          style={{
            position: "relative",
            minHeight: 140,
            borderRadius: 12,
            background: "#f3f4f6",
            overflow: "hidden",
          }}
        >
          {settings.nudge_enabled && settings.enabled ? (
            <div
              style={{
                position: "absolute",
                bottom: 72,
                right: settings.position === "bottom-right" ? 16 : undefined,
                left: settings.position === "bottom-left" ? 16 : undefined,
                maxWidth: 200,
                padding: "8px 12px",
                borderRadius: 10,
                background: settings.background_color,
                color: settings.text_color,
                fontSize: 12,
              }}
            >
              {nudge}
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              right: settings.position === "bottom-right" ? 16 : undefined,
              left: settings.position === "bottom-left" ? 16 : undefined,
              padding: "10px 16px",
              borderRadius: 999,
              background: settings.primary_color,
              color: "#111",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ★ {settings.launcher_label}
          </div>
        </div>
      </BlockStack>
    </Box>
  );
}

function AppearanceForm({ settings }: { settings: WidgetSettings }) {
  const [state, setState] = useState(settings);

  useEffect(() => {
    setState(settings);
  }, [settings]);

  const patch = (partial: Partial<WidgetSettings>) =>
    setState((prev) => ({ ...prev, ...partial }));

  return (
    <Form method="post">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Widget durumu
            </Text>
            <Checkbox
              label="Storefront widget'ı göster"
              checked={state.enabled}
              onChange={(v) => patch({ enabled: v })}
            />
            <input
              type="hidden"
              name="widget_enabled"
              value={state.enabled ? "on" : "off"}
            />
            <Banner tone="info">
              <p>
                Temada etkinleştirmek için: <strong>Online Store → Customize →
                App embeds → Anka Loyalty</strong>
              </p>
            </Banner>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Görünüm
            </Text>
            <InlineStack gap="400" wrap>
              <ColorField
                label="Vurgu rengi"
                name="primary_color"
                value={state.primary_color}
                onChange={(v) => patch({ primary_color: v })}
              />
              <ColorField
                label="Panel arka plan"
                name="background_color"
                value={state.background_color}
                onChange={(v) => patch({ background_color: v })}
              />
              <ColorField
                label="Metin rengi"
                name="text_color"
                value={state.text_color}
                onChange={(v) => patch({ text_color: v })}
              />
            </InlineStack>
            <Select
              label="Konum"
              name="position"
              options={[
                { label: "Sağ alt", value: "bottom-right" },
                { label: "Sol alt", value: "bottom-left" },
              ]}
              value={state.position}
              onChange={(v) =>
                patch({ position: v as WidgetSettings["position"] })
              }
            />
            <WidgetPreview settings={state} />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Metinler
            </Text>
            <TextField
              label="Launcher butonu metni"
              name="launcher_label"
              value={state.launcher_label}
              onChange={(v) => patch({ launcher_label: v })}
              autoComplete="off"
              helpText="Sağ alttaki butonda görünen yazı"
            />
            <Checkbox
              label="Nudge balonunu göster"
              checked={state.nudge_enabled}
              onChange={(v) => patch({ nudge_enabled: v })}
            />
            <input
              type="hidden"
              name="nudge_enabled"
              value={state.nudge_enabled ? "on" : "off"}
            />
            <TextField
              label="Nudge balonu metni"
              name="nudge_text"
              value={state.nudge_text}
              onChange={(v) => patch({ nudge_text: v })}
              autoComplete="off"
              helpText="{{balance}} yer tutucusu müşterinin puan bakiyesi ile değiştirilir"
            />
            <TextField
              label="Misafir başlık (giriş yapmamış)"
              name="guest_headline"
              value={state.guest_headline}
              onChange={(v) => patch({ guest_headline: v })}
              autoComplete="off"
            />
            <TextField
              label="Misafir açıklama"
              name="guest_body"
              value={state.guest_body}
              onChange={(v) => patch({ guest_body: v })}
              autoComplete="off"
              multiline={3}
              helpText="Giriş yapmamış ziyaretçilere gösterilir. {{points_per_dollar}} kullanılabilir."
            />
            <InlineStack align="end">
              <Button submit variant="primary">
                Kaydet
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Form>
  );
}

export default function AppearancePage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Görünüm ayarları kaydedildi");
    }
  }, [actionData, shopify]);

  if (data.missingStore) {
    return (
      <Page title="Görünüm">
        <TitleBar title="Görünüm" />
        <Banner tone="warning">Mağaza kaydı bulunamadı. Uygulamayı yeniden yükleyin.</Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Görünüm"
      subtitle="Storefront widget rengi, metinleri ve konumu"
    >
      <TitleBar title="Görünüm" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.ok === false ? (
              <Banner tone="critical">{actionData.error}</Banner>
            ) : null}
            <AppearanceForm settings={data.settings} />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
