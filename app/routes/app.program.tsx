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
  Badge,
  Banner,
  Select,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import {
  getProgramData,
  updateRedemptions,
  updateRules,
  updateStorePoints,
  updateTiers,
  createCampaign,
  toggleCampaign,
  deleteCampaign,
  addExclusion,
  deleteExclusion,
} from "../lib/program.server";
import type {
  RedemptionRow,
  RuleRow,
  StorePointsSettings,
  TierRow,
  CampaignRow,
  ExclusionRow,
} from "../lib/program.server";
import { RULE_LABELS, REWARD_TYPE_LABELS } from "../lib/program-labels";
import { buildCampaignAnnouncementText } from "../lib/campaign-announcement";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return { missingStore: true as const };
  }

  const program = await getProgramData(store.id);
  return { missingStore: false as const, ...program };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);
  if (!store) {
    return { ok: false, error: "Mağaza bulunamadı" };
  }

  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
  switch (intent) {
    case "store_points":
      await updateStorePoints(store.id, form);
      break;
    case "rules":
      await updateRules(store.id, form);
      break;
    case "tiers":
      await updateTiers(store.id, form);
      break;
    case "redemptions":
      await updateRedemptions(store.id, form);
      break;
    case "create_campaign":
      await createCampaign(store.id, form);
      break;
    case "toggle_campaign": {
      const id = String(form.get("campaign_id"));
      const active = form.get("campaign_active") === "on";
      await toggleCampaign(store.id, id, active);
      break;
    }
    case "delete_campaign":
      await deleteCampaign(store.id, String(form.get("campaign_id")));
      break;
    case "add_exclusion":
      await addExclusion(store.id, form);
      break;
    case "delete_exclusion":
      await deleteExclusion(store.id, String(form.get("exclusion_id")));
      break;
    default:
      return { ok: false, error: "Bilinmeyen işlem" };
  }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kayıt başarısız",
    };
  }

  return { ok: true, intent };
};

function PointsRateSection({ store }: { store: StorePointsSettings }) {
  const [perDollar, setPerDollar] = useState(String(store.points_per_dollar));
  const [ratio, setRatio] = useState(String(store.points_to_dollar_ratio));
  const [expiry, setExpiry] = useState(
    store.points_expiry_months != null
      ? String(store.points_expiry_months)
      : "off",
  );

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="store_points" />
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Puan Oranı & Expiry
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Satın almada kazanılan ve harcamada kullanılan puan oranları.
              Expiry: son aktiviteden sonra puan yanması (Dashboard cron).
            </Text>
          </BlockStack>
          <InlineStack gap="400" wrap>
            <Box minWidth="220px">
              <TextField
                label="Kazanım: $1 = kaç puan"
                type="number"
                name="points_per_dollar"
                value={perDollar}
                onChange={setPerDollar}
                autoComplete="off"
                suffix="puan / $"
                min={0}
                step={0.1}
              />
            </Box>
            <Box minWidth="220px">
              <TextField
                label="Harcama: kaç puan = $1"
                type="number"
                name="points_to_dollar_ratio"
                value={ratio}
                onChange={setRatio}
                autoComplete="off"
                suffix="puan / $"
                min={1}
                step={1}
              />
            </Box>
            <Box minWidth="220px">
              <Select
                label="Puan expiry"
                name="points_expiry_months"
                options={[
                  { label: "Kapalı", value: "off" },
                  { label: "6 ay", value: "6" },
                  { label: "12 ay", value: "12" },
                  { label: "24 ay", value: "24" },
                ]}
                value={expiry}
                onChange={setExpiry}
              />
            </Box>
          </InlineStack>
          <InlineStack align="end">
            <Button submit variant="primary">
              Kaydet
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

type RuleState = Record<string, { enabled: boolean; points: string }>;

function RulesSection({ rules }: { rules: RuleRow[] }) {
  const bonusRules = rules.filter((r) => r.rule_type !== "points_per_dollar");
  const [state, setState] = useState<RuleState>(() =>
    Object.fromEntries(
      bonusRules.map((r) => [
        r.id,
        { enabled: r.enabled, points: String(r.points_value) },
      ]),
    ),
  );

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="rules" />
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Kazanım Kuralları
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Bonus puan kuralları.
            </Text>
          </BlockStack>
          <BlockStack gap="300">
            {bonusRules.map((r) => {
              const s = state[r.id];
              return (
                <InlineStack
                  key={r.id}
                  align="space-between"
                  blockAlign="center"
                  gap="400"
                  wrap={false}
                >
                  <input type="hidden" name="rule_id" value={r.id} />
                  <input
                    type="hidden"
                    name={`rule_enabled_${r.id}`}
                    value={s.enabled ? "on" : "off"}
                  />
                  <Checkbox
                    label={RULE_LABELS[r.rule_type]}
                    checked={s.enabled}
                    onChange={(v) =>
                      setState((p) => ({ ...p, [r.id]: { ...p[r.id], enabled: v } }))
                    }
                  />
                  <Box minWidth="130px">
                    <TextField
                      label="Puan"
                      labelHidden
                      type="number"
                      name={`rule_points_${r.id}`}
                      value={s.points}
                      onChange={(v) =>
                        setState((p) => ({ ...p, [r.id]: { ...p[r.id], points: v } }))
                      }
                      autoComplete="off"
                      suffix="puan"
                      min={0}
                      disabled={!s.enabled}
                    />
                  </Box>
                </InlineStack>
              );
            })}
          </BlockStack>
          <InlineStack align="end">
            <Button submit variant="primary">
              Kuralları Kaydet
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

type TierState = Record<
  string,
  { threshold: string; discount: string; multiplier: string }
>;

function TiersSection({ tiers }: { tiers: TierRow[] }) {
  const [state, setState] = useState<TierState>(() =>
    Object.fromEntries(
      tiers.map((t) => [
        t.id,
        {
          threshold: String(t.threshold_spend),
          discount: String(t.discount_percent),
          multiplier: String(t.points_multiplier),
        },
      ]),
    ),
  );

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="tiers" />
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            VIP Tier'lar
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Shopify&apos;da müşteri tag&apos;i otomatik atanır (ör. anka-tier-gold). İndirim
            için Discounts → otomatik indirim → müşteri tag koşulu kullanın.
          </Text>
          <BlockStack gap="400">
            {tiers.map((t) => {
              const s = state[t.id];
              return (
                <Box
                  key={t.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Badge tone="info">{t.name}</Badge>
                    <input type="hidden" name="tier_id" value={t.id} />
                    <InlineStack gap="300" wrap>
                      <Box minWidth="150px">
                        <TextField
                          label="Eşik harcama ($)"
                          type="number"
                          name={`tier_threshold_${t.id}`}
                          value={s.threshold}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [t.id]: { ...p[t.id], threshold: v },
                            }))
                          }
                          autoComplete="off"
                          min={0}
                          disabled={t.slug === "bronze"}
                        />
                      </Box>
                      <Box minWidth="140px">
                        <TextField
                          label="İndirim (%)"
                          type="number"
                          name={`tier_discount_${t.id}`}
                          value={s.discount}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [t.id]: { ...p[t.id], discount: v },
                            }))
                          }
                          autoComplete="off"
                          min={0}
                        />
                      </Box>
                      <Box minWidth="150px">
                        <TextField
                          label="Puan çarpanı"
                          type="number"
                          name={`tier_multiplier_${t.id}`}
                          value={s.multiplier}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [t.id]: { ...p[t.id], multiplier: v },
                            }))
                          }
                          autoComplete="off"
                          min={0}
                          step={0.05}
                        />
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
          <InlineStack align="end">
            <Button submit variant="primary">
              Tier'ları Kaydet
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

type RedemptionState = Record<
  string,
  { enabled: boolean; cost: string; value: string }
>;

function RedemptionsSection({ redemptions }: { redemptions: RedemptionRow[] }) {
  const [state, setState] = useState<RedemptionState>(() =>
    Object.fromEntries(
      redemptions.map((r) => [
        r.id,
        {
          enabled: r.enabled,
          cost: String(r.points_cost),
          value: r.reward_value != null ? String(r.reward_value) : "",
        },
      ]),
    ),
  );

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="redemptions" />
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Ödüller (Kupon Kademeleri)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Müşterinin puanını çevirebileceği kupon kademeleri.
            </Text>
          </BlockStack>
          <BlockStack gap="300">
            {redemptions.map((r) => {
              const s = state[r.id];
              return (
                <Box
                  key={r.id}
                  padding="300"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="medium">
                        {r.name}
                      </Text>
                      <Badge>{REWARD_TYPE_LABELS[r.reward_type] ?? r.reward_type}</Badge>
                    </InlineStack>
                    <input type="hidden" name="redemption_id" value={r.id} />
                    <input
                      type="hidden"
                      name={`redemption_enabled_${r.id}`}
                      value={s.enabled ? "on" : "off"}
                    />
                    <InlineStack gap="300" blockAlign="center" wrap>
                      <Box minWidth="150px">
                        <TextField
                          label="Puan maliyeti"
                          type="number"
                          name={`redemption_cost_${r.id}`}
                          value={s.cost}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [r.id]: { ...p[r.id], cost: v },
                            }))
                          }
                          autoComplete="off"
                          min={1}
                          suffix="puan"
                        />
                      </Box>
                      <Box minWidth="150px">
                        <TextField
                          label="Ödül değeri"
                          type="number"
                          name={`redemption_value_${r.id}`}
                          value={s.value}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [r.id]: { ...p[r.id], value: v },
                            }))
                          }
                          autoComplete="off"
                          min={0}
                        />
                      </Box>
                      <Box paddingBlockStart="500">
                        <Checkbox
                          label="Aktif"
                          checked={s.enabled}
                          onChange={(v) =>
                            setState((p) => ({
                              ...p,
                              [r.id]: { ...p[r.id], enabled: v },
                            }))
                          }
                        />
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
          <InlineStack align="end">
            <Button submit variant="primary">
              Ödülleri Kaydet
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

function CampaignAnnouncementCopy({ campaign }: { campaign: CampaignRow }) {
  const shopify = useAppBridge();
  const text = buildCampaignAnnouncementText(campaign);

  return (
    <Box paddingBlockStart="200">
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" fontWeight="semibold">
          Duyuru metni (kopyala)
        </Text>
        <Box
          padding="300"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <Text as="p" variant="bodySm">
            <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
          </Text>
        </Box>
        <InlineStack align="start">
          <Button
            size="slim"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              shopify.toast.show("Duyuru metni kopyalandı");
            }}
          >
            Metni kopyala
          </Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function CampaignsSection({ campaigns }: { campaigns: CampaignRow[] }) {
  const [name, setName] = useState("");
  const [multiplier, setMultiplier] = useState("2");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [collections, setCollections] = useState("");
  const [active, setActive] = useState(true);

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("tr-TR");
    } catch {
      return iso;
    }
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Bonus Kampanyalar
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Tarih aralığında ek puan çarpanı. Koleksiyon ID boş = tüm sipariş.
            Çarpan tier çarpanı ile çarpılır.
          </Text>
          {campaigns.map((c) => (
            <Box
              key={c.id}
              padding="300"
              borderWidth="025"
              borderColor="border"
              borderRadius="200"
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" fontWeight="semibold">
                    {c.name}
                  </Text>
                  <Badge tone={c.is_active ? "success" : undefined}>
                    {c.is_active ? "Aktif" : "Pasif"} · {c.multiplier}x
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {fmtDate(c.starts_at)} — {fmtDate(c.ends_at)}
                  {c.collection_ids.length > 0
                    ? ` · Koleksiyon: ${c.collection_ids.join(", ")}`
                    : " · Tüm ürünler"}
                </Text>
                <InlineStack gap="200">
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle_campaign" />
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <input
                      type="hidden"
                      name="campaign_active"
                      value={c.is_active ? "off" : "on"}
                    />
                    <Button submit size="slim">
                      {c.is_active ? "Durdur" : "Aktive et"}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_campaign" />
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <Button submit size="slim" tone="critical">
                      Sil
                    </Button>
                  </Form>
                </InlineStack>
                {c.is_active ? (
                  <CampaignAnnouncementCopy campaign={c} />
                ) : null}
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </Card>

      <Card>
        <Form method="post">
          <input type="hidden" name="intent" value="create_campaign" />
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Yeni kampanya
            </Text>
            <TextField label="Ad" name="campaign_name" value={name} onChange={setName} autoComplete="off" />
            <InlineStack gap="300" wrap>
              <Box minWidth="120px">
                <TextField
                  label="Çarpan"
                  name="campaign_multiplier"
                  type="number"
                  value={multiplier}
                  onChange={setMultiplier}
                  min={1}
                  step={0.5}
                  autoComplete="off"
                />
              </Box>
              <Box minWidth="180px">
                <TextField
                  label="Başlangıç"
                  name="campaign_starts_at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={setStartsAt}
                  autoComplete="off"
                />
              </Box>
              <Box minWidth="180px">
                <TextField
                  label="Bitiş"
                  name="campaign_ends_at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={setEndsAt}
                  autoComplete="off"
                />
              </Box>
            </InlineStack>
            <TextField
              label="Koleksiyon ID'leri (virgülle, opsiyonel)"
              name="campaign_collection_ids"
              value={collections}
              onChange={setCollections}
              autoComplete="off"
              placeholder="123456789, 987654321"
            />
            <input type="hidden" name="campaign_is_active" value={active ? "on" : "off"} />
            <Checkbox label="Oluşturur oluşturmaz aktif" checked={active} onChange={setActive} />
            <InlineStack align="end">
              <Button submit variant="primary">
                Kampanya oluştur
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
    </BlockStack>
  );
}

function ExclusionsSection({ exclusions }: { exclusions: ExclusionRow[] }) {
  const [type, setType] = useState("product");
  const [resourceId, setResourceId] = useState("");

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Puan Hariç Tutma
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Shopify ürün veya koleksiyon ID — bu kaynaklardan puan kazanılmaz.
          </Text>
          {exclusions.length === 0 ? (
            <Text as="p" tone="subdued">
              Henüz hariç tutma yok.
            </Text>
          ) : (
            exclusions.map((e) => (
              <InlineStack key={e.id} align="space-between" blockAlign="center">
                <Text as="span">
                  {e.resource_type === "product" ? "Ürün" : "Koleksiyon"} #{e.shopify_resource_id}
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete_exclusion" />
                  <input type="hidden" name="exclusion_id" value={e.id} />
                  <Button submit size="slim" tone="critical">
                    Kaldır
                  </Button>
                </Form>
              </InlineStack>
            ))
          )}
        </BlockStack>
      </Card>
      <Card>
        <Form method="post">
          <input type="hidden" name="intent" value="add_exclusion" />
          <BlockStack gap="300">
            <Select
              label="Tip"
              name="exclusion_type"
              options={[
                { label: "Ürün", value: "product" },
                { label: "Koleksiyon", value: "collection" },
              ]}
              value={type}
              onChange={setType}
            />
            <TextField
              label="Shopify kaynak ID"
              name="exclusion_resource_id"
              value={resourceId}
              onChange={setResourceId}
              autoComplete="off"
            />
            <InlineStack align="end">
              <Button submit variant="primary">
                Ekle
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
    </BlockStack>
  );
}

export default function Program() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok && navigation.state === "idle") {
      shopify.toast.show("Kaydedildi");
    }
    if (actionData && !actionData.ok && navigation.state === "idle") {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, navigation.state, shopify]);

  if (data.missingStore) {
    return (
      <Page title="Program">
        <TitleBar title="Program" />
        <Banner tone="critical" title="Mağaza kaydı bulunamadı">
          <p>Uygulamayı yeniden kurmayı deneyin.</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Program">
      <TitleBar title="Program" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <PointsRateSection store={data.store} />
            <RulesSection rules={data.rules} />
            <CampaignsSection campaigns={data.campaigns} />
            <ExclusionsSection exclusions={data.exclusions} />
            <RedemptionsSection redemptions={data.redemptions} />
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <TiersSection tiers={data.tiers} />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
