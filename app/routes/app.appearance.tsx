import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
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
  Tabs,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrEnsureStoreByDomain } from "../lib/store.server";
import {
  getWidgetSettingsForStore,
  updateWidgetSettings,
} from "../lib/appearance.server";
import type { WidgetSettings } from "../lib/widget-settings";
import {
  formatNudgeText,
  LOCALE_COPY_FIELDS,
  WIDGET_FEATURE_FIELDS,
  type WidgetPanelDirection,
} from "../lib/widget-settings";
import {
  fetchShopLocales,
  primaryLocale,
  type ShopLocaleInfo,
} from "../lib/shop-locales.server";
import {
  localeDisplayName,
  normalizeLocaleCode,
  resolveWidgetCopy,
  type WidgetLocaleCopy,
} from "../lib/widget-i18n";

function mergedLocaleCopy(
  settings: WidgetSettings,
  locale: string,
): WidgetLocaleCopy {
  return resolveWidgetCopy(
    settings.locales,
    settings.default_locale,
    locale,
  ).copy;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);

  const [settings, shopLocales] = await Promise.all([
    getWidgetSettingsForStore(store.id),
    fetchShopLocales(admin),
  ]);

  const primary = primaryLocale(shopLocales);
  const settingsWithDefault = {
    ...settings,
    default_locale: settings.default_locale || primary,
  };

  return {
    settings: settingsWithDefault,
    shopLocales,
    primaryLocale: primary,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);

  const form = await request.formData();
  try {
    await updateWidgetSettings(store.id, form);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed",
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
          aria-label={`${props.label} color picker`}
          style={{ width: "100%", height: 36, border: "none", cursor: "pointer" }}
        />
      </BlockStack>
    </Box>
  );
}

function WidgetPreview({ settings, locale }: { settings: WidgetSettings; locale: string }) {
  const copy = mergedLocaleCopy(settings, locale);
  const sampleBalance = 1250;
  const nudge = formatNudgeText(copy.nudge_text, sampleBalance);
  const compact =
    !settings.show_earn_tab && !settings.show_redeem_tab;

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
          Preview — {localeDisplayName(locale)} ({locale})
          {compact ? " · balance-only mode" : ""}
        </Text>
        <div
          style={{
            position: "relative",
            minHeight: 160,
            borderRadius: 12,
            background: "#eef0f3",
            overflow: "hidden",
          }}
        >
          {settings.nudge_enabled && settings.enabled ? (
            <div
              style={{
                position: "absolute",
                bottom: 76,
                right: settings.position === "bottom-right" ? 16 : undefined,
                left: settings.position === "bottom-left" ? 16 : undefined,
                maxWidth: 200,
                padding: "8px 12px",
                borderRadius: 12,
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
              padding: "10px 18px",
              borderRadius: 999,
              background: settings.primary_color,
              color: "#111",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            ★ {copy.launcher_label}
          </div>
        </div>
      </BlockStack>
    </Box>
  );
}

function LocaleFields(props: {
  locale: string;
  copy: WidgetLocaleCopy;
  onChange: (key: keyof WidgetLocaleCopy, value: string) => void;
}) {
  return (
    <BlockStack gap="300">
      {LOCALE_COPY_FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          name={`locale_${props.locale}_${field.key}`}
          value={props.copy[field.key] ?? ""}
          onChange={(v) => props.onChange(field.key, v)}
          autoComplete="off"
          multiline={field.multiline ? 3 : undefined}
          helpText={field.help}
        />
      ))}
    </BlockStack>
  );
}

function AppearanceForm(props: {
  settings: WidgetSettings;
  shopLocales: ShopLocaleInfo[];
  primaryLocale: string;
}) {
  const publishedCodes = props.shopLocales.map((l) =>
    normalizeLocaleCode(l.locale),
  );
  const uniqueCodes = [...new Set(publishedCodes)];

  const [state, setState] = useState(props.settings);
  const [activeTab, setActiveTab] = useState(
    normalizeLocaleCode(props.settings.default_locale || props.primaryLocale),
  );

  useEffect(() => {
    setState(props.settings);
  }, [props.settings]);

  const patch = (partial: Partial<WidgetSettings>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const patchLocale = (
    locale: string,
    key: keyof WidgetLocaleCopy,
    value: string,
  ) => {
    setState((prev) => ({
      ...prev,
      locales: {
        ...prev.locales,
        [locale]: {
          ...prev.locales[locale],
          [key]: value,
        },
      },
    }));
  };

  const tabs = uniqueCodes.map((code) => ({
    id: code,
    content: code,
    accessibilityLabel: localeDisplayName(code),
    panelID: `locale-${code}`,
  }));

  const activeCopy = mergedLocaleCopy(state, activeTab);
  const selectedTabIndex = Math.max(0, uniqueCodes.indexOf(activeTab));

  return (
    <Form method="post">
      <input
        type="hidden"
        name="locale_codes"
        value={uniqueCodes.join(",")}
      />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Widget status
            </Text>
            <Checkbox
              label="Show storefront widget"
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
                In theme: <strong>Online Store → Customize → App embeds → Anka Loyalty</strong>.
                Copy is chosen by store language; customize each locale below.
              </p>
            </Banner>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Position &amp; panel direction
            </Text>
            <InlineStack gap="400" wrap>
              <Box minWidth="200px">
                <Select
                  label="Launcher position"
                  name="position"
                  options={[
                    { label: "Bottom right", value: "bottom-right" },
                    { label: "Bottom left", value: "bottom-left" },
                  ]}
                  value={state.position}
                  onChange={(v) =>
                    patch({ position: v as WidgetSettings["position"] })
                  }
                />
              </Box>
              <Box minWidth="200px">
                <Select
                  label="Panel open direction"
                  name="panel_direction"
                  options={[
                    { label: "Up (above button)", value: "up" },
                    { label: "Left", value: "left" },
                    { label: "Right", value: "right" },
                  ]}
                  value={state.panel_direction}
                  onChange={(v) =>
                    patch({
                      panel_direction: v as WidgetPanelDirection,
                    })
                  }
                  helpText="Panel opens in this direction relative to the launcher"
                />
              </Box>
              <Box minWidth="200px">
                <Select
                  label="Default locale"
                  name="default_locale"
                  options={uniqueCodes.map((code) => ({
                    label: localeDisplayName(code),
                    value: code,
                  }))}
                  value={state.default_locale}
                  onChange={(v) => patch({ default_locale: v })}
                  helpText="Fallback when store locale has no custom copy"
                />
              </Box>
            </InlineStack>
            <InlineStack gap="400" wrap>
              <ColorField
                label="Accent color"
                name="primary_color"
                value={state.primary_color}
                onChange={(v) => patch({ primary_color: v })}
              />
              <ColorField
                label="Panel background"
                name="background_color"
                value={state.background_color}
                onChange={(v) => patch({ background_color: v })}
              />
              <ColorField
                label="Text color"
                name="text_color"
                value={state.text_color}
                onChange={(v) => patch({ text_color: v })}
              />
            </InlineStack>
            <WidgetPreview settings={state} locale={activeTab} />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Panel content
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Choose what customers see inside the widget. Turn off Redeem to show
              only points balance (and optional tier progress).
            </Text>
            {WIDGET_FEATURE_FIELDS.map((field) => (
              <BlockStack key={field.key} gap="100">
                <Checkbox
                  label={field.label}
                  checked={state[field.key]}
                  onChange={(v) => patch({ [field.key]: v })}
                />
                {field.help ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {field.help}
                  </Text>
                ) : null}
                <input
                  type="hidden"
                  name={field.key}
                  value={state[field.key] ? "on" : "off"}
                />
              </BlockStack>
            ))}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Cart slider
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Points slider in cart drawer / cart page. Customer slides to choose
              points, a coupon is created and applied automatically.
            </Text>
            <Banner tone="info">
              <p>
                After enabling: <strong>Online Store → Customize → App embeds →
                Anka Cart Points Slider</strong> must be turned on.
              </p>
            </Banner>
            <Checkbox
              label="Enable cart points slider"
              checked={state.cart_slider_enabled}
              onChange={(v) => patch({ cart_slider_enabled: v })}
            />
            <input
              type="hidden"
              name="cart_slider_enabled"
              value={state.cart_slider_enabled ? "on" : "off"}
            />
            <InlineStack gap="400" wrap>
              <Box minWidth="200px">
                <TextField
                  label="Minimum points"
                  name="cart_slider_min_points"
                  type="number"
                  value={String(state.cart_slider_min_points)}
                  onChange={(v) =>
                    patch({ cart_slider_min_points: Math.max(0, Number(v) || 0) })
                  }
                  autoComplete="off"
                  helpText="0 = use points-to-dollar ratio from Program"
                  min={0}
                />
              </Box>
              <Box minWidth="200px">
                <TextField
                  label="Maximum points per redemption"
                  name="cart_slider_max_points"
                  type="number"
                  value={String(state.cart_slider_max_points)}
                  onChange={(v) =>
                    patch({ cart_slider_max_points: Math.max(0, Number(v) || 0) })
                  }
                  autoComplete="off"
                  helpText="0 = no cap (full balance)"
                  min={0}
                />
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Copy (multi-language)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Published Shopify locales:{" "}
              {props.shopLocales.map((l) => l.name).join(", ")}. Empty fields
              use built-in translations (EN/TR).
            </Text>
            {tabs.length > 1 ? (
              <Tabs
                tabs={tabs}
                selected={selectedTabIndex}
                onSelect={(index) =>
                  setActiveTab(uniqueCodes[index] ?? uniqueCodes[0] ?? activeTab)
                }
              />
            ) : null}
            <LocaleFields
              locale={activeTab}
              copy={activeCopy}
              onChange={(key, value) => patchLocale(activeTab, key, value)}
            />
            <InlineStack align="end">
              <Button submit variant="primary">
                Save
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
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Appearance settings saved");
    }
  }, [actionData, shopify]);

  return (
    <Page
      title="Appearance"
      subtitle="Widget position, panel direction, colors, and locale copy"
    >
      <TitleBar title="Appearance" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.ok === false && "error" in actionData ? (
              <Banner tone="critical">{actionData.error}</Banner>
            ) : null}
            <AppearanceForm
              settings={data.settings}
              shopLocales={data.shopLocales}
              primaryLocale={data.primaryLocale}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
