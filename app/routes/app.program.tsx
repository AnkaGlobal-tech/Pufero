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
import { getOrEnsureStoreByDomain } from "../lib/store.server";
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
import {
  currencyUnitLabel,
  getShopCurrencyCode,
} from "../lib/shop-currency.server";
import {
  getPointsSetupState,
  markPointsSetupCompleted,
  recalculatePurchasePointsForRate,
} from "../lib/points-setup.server";
import { backfillRecentOrders } from "../lib/klaviyo-backfill.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);
  const [program, currencyCode, setup] = await Promise.all([
    getProgramData(store.id),
    getShopCurrencyCode(admin),
    getPointsSetupState(store.id),
  ]);

  return {
    ...program,
    currencyCode,
    currencyLabel: currencyUnitLabel(currencyCode),
    setupCompletedAt: setup.setupCompletedAt,
    backfillCompletedAt: setup.backfillCompletedAt,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrEnsureStoreByDomain(session.shop);

  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
  switch (intent) {
    case "store_points": {
      await updateStorePoints(store.id, form);
      const currencyCode = await getShopCurrencyCode(admin);
      await markPointsSetupCompleted({
        storeId: store.id,
        shopCurrency: currencyCode,
      });

      if (form.get("recalculate_existing") === "on") {
        const newRate = Math.max(
          0,
          parseFloat(String(form.get("points_per_dollar") ?? "1")) || 0,
        );
        const recalc = await recalculatePurchasePointsForRate({
          storeId: store.id,
          newPointsPerUnit: newRate,
        });
        return { ok: true, intent, recalc };
      }
      break;
    }
    case "backfill_orders": {
      const result = await backfillRecentOrders({ admin, store, days: 60 });
      return { ok: true, intent, result };
    }
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
      return { ok: false, error: "Unknown action" };
  }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }

  return { ok: true, intent };
};

function PointsRateSection({
  store,
  currencyCode,
  currencyLabel,
}: {
  store: StorePointsSettings;
  currencyCode: string;
  currencyLabel: string;
}) {
  const [perDollar, setPerDollar] = useState(String(store.points_per_dollar));
  const [ratio, setRatio] = useState(String(store.points_to_dollar_ratio));
  const [expiry, setExpiry] = useState(
    store.points_expiry_months != null
      ? String(store.points_expiry_months)
      : "off",
  );
  const [recalculate, setRecalculate] = useState(false);

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="store_points" />
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Points rate & currency
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Shop currency is <strong>{currencyCode}</strong>. Earn and redeem
              rates use this currency (order subtotals are already in shop
              money — e.g. TL for Turkish stores, not USD).
            </Text>
          </BlockStack>
          <InlineStack gap="400" wrap>
            <Box minWidth="240px">
              <TextField
                label={`Earn: 1 ${currencyLabel} = how many points`}
                type="number"
                name="points_per_dollar"
                value={perDollar}
                onChange={setPerDollar}
                autoComplete="off"
                suffix={`pts / ${currencyLabel}`}
                min={0}
                step={0.1}
                helpText={`Example: 1 → 100 ${currencyLabel} order = 100 points`}
              />
            </Box>
            <Box minWidth="240px">
              <TextField
                label={`Redeem: how many points = 1 ${currencyLabel}`}
                type="number"
                name="points_to_dollar_ratio"
                value={ratio}
                onChange={setRatio}
                autoComplete="off"
                suffix={`pts / ${currencyLabel}`}
                min={1}
                step={1}
                helpText={`Example: 100 → 100 points = 1 ${currencyLabel} discount`}
              />
            </Box>
            <Box minWidth="220px">
              <Select
                label="Points expiry"
                name="points_expiry_months"
                options={[
                  { label: "Off", value: "off" },
                  { label: "6 months", value: "6" },
                  { label: "12 months", value: "12" },
                  { label: "24 months", value: "24" },
                ]}
                value={expiry}
                onChange={setExpiry}
              />
            </Box>
          </InlineStack>
          <Checkbox
            label="Recalculate existing purchase points with this earn rate"
            helpText="Adjusts past order/draft purchase points to the new rate. Fixed bonuses (first order, bulk, etc.) stay the same."
            checked={recalculate}
            onChange={setRecalculate}
            name="recalculate_existing"
          />
          {recalculate ? (
            <input type="hidden" name="recalculate_existing" value="on" />
          ) : null}
          <InlineStack align="end">
            <Button submit variant="primary">
              Save rates
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Form>
  );
}

function HistoricalImportSection({
  backfillCompletedAt,
}: {
  backfillCompletedAt: string | null;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Import last 60 days of orders
          </Text>
          {backfillCompletedAt ? <Badge tone="success">Done</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Awards loyalty points for paid Shopify orders from the last 60 days
          using your current earn rate. Safe to run again (idempotent). Set
          rates above first, then import — no Klaviyo required.
        </Text>
        <Form method="post">
          <input type="hidden" name="intent" value="backfill_orders" />
          <Button submit variant="primary">
            Run 60-day order backfill
          </Button>
        </Form>
      </BlockStack>
    </Card>
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
              Earning Rules
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Bonus point rules.
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
                      label="Points"
                      labelHidden
                      type="number"
                      name={`rule_points_${r.id}`}
                      value={s.points}
                      onChange={(v) =>
                        setState((p) => ({ ...p, [r.id]: { ...p[r.id], points: v } }))
                      }
                      autoComplete="off"
                      suffix="pts"
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
              Save Rules
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
            VIP Tiers
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Customer tags are assigned automatically in Shopify (e.g. tier-gold). For
            discounts, use Discounts → automatic discount → customer tag condition.
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
                          label="Threshold spend ($)"
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
                          label="Discount (%)"
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
                          label="Points multiplier"
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
              Save Tiers
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
              Rewards (Coupon Tiers)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Coupon tiers customers can redeem points for.
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
                          label="Points cost"
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
                          suffix="pts"
                        />
                      </Box>
                      <Box minWidth="150px">
                        <TextField
                          label="Reward value"
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
                          label="Active"
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
              Save Rewards
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
          Announcement text (copy)
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
              shopify.toast.show("Announcement text copied");
            }}
          >
            Copy text
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
      return new Date(iso).toLocaleDateString("en-US");
    } catch {
      return iso;
    }
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Bonus Campaigns
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Extra points multiplier within a date range. Empty collection ID = entire order.
            Multiplier stacks with tier multiplier.
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
                    {`${c.is_active ? "Active" : "Inactive"} · ${c.multiplier}x`}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {fmtDate(c.starts_at)} — {fmtDate(c.ends_at)}
                  {c.collection_ids.length > 0
                    ? ` · Collection: ${c.collection_ids.join(", ")}`
                    : " · All products"}
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
                      {c.is_active ? "Pause" : "Activate"}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_campaign" />
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <Button submit size="slim" tone="critical">
                      Delete
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
              New campaign
            </Text>
            <TextField label="Name" name="campaign_name" value={name} onChange={setName} autoComplete="off" />
            <InlineStack gap="300" wrap>
              <Box minWidth="120px">
                <TextField
                  label="Multiplier"
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
                  label="Start"
                  name="campaign_starts_at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={setStartsAt}
                  autoComplete="off"
                />
              </Box>
              <Box minWidth="180px">
                <TextField
                  label="End"
                  name="campaign_ends_at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={setEndsAt}
                  autoComplete="off"
                />
              </Box>
            </InlineStack>
            <TextField
              label="Collection IDs (comma-separated, optional)"
              name="campaign_collection_ids"
              value={collections}
              onChange={setCollections}
              autoComplete="off"
              placeholder="123456789, 987654321"
            />
            <input type="hidden" name="campaign_is_active" value={active ? "on" : "off"} />
            <Checkbox label="Active immediately on create" checked={active} onChange={setActive} />
            <InlineStack align="end">
              <Button submit variant="primary">
                Create campaign
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
            Point Exclusions
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Shopify product or collection ID — no points earned from these resources.
          </Text>
          {exclusions.length === 0 ? (
            <Text as="p" tone="subdued">
              No exclusions yet.
            </Text>
          ) : (
            exclusions.map((e) => (
              <InlineStack key={e.id} align="space-between" blockAlign="center">
                <Text as="span">
                  {e.resource_type === "product" ? "Product" : "Collection"} #{e.shopify_resource_id}
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete_exclusion" />
                  <input type="hidden" name="exclusion_id" value={e.id} />
                  <Button submit size="slim" tone="critical">
                    Remove
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
              label="Type"
              name="exclusion_type"
              options={[
                { label: "Product", value: "product" },
                { label: "Collection", value: "collection" },
              ]}
              value={type}
              onChange={setType}
            />
            <TextField
              label="Shopify resource ID"
              name="exclusion_resource_id"
              value={resourceId}
              onChange={setResourceId}
              autoComplete="off"
            />
            <InlineStack align="end">
              <Button submit variant="primary">
                Add
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
      if (actionData.intent === "backfill_orders" && "result" in actionData) {
        shopify.toast.show(
          `Backfill: ${actionData.result.awarded} awarded / ${actionData.result.scanned} scanned`,
        );
      } else if (actionData.intent === "store_points" && "recalc" in actionData && actionData.recalc) {
        shopify.toast.show(
          `Rates saved · ${actionData.recalc.adjusted} balances adjusted`,
        );
      } else {
        shopify.toast.show("Saved");
      }
    }
    if (actionData && !actionData.ok && "error" in actionData && navigation.state === "idle") {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, navigation.state, shopify]);

  return (
    <Page title="Program">
      <TitleBar title="Program" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {!data.setupCompletedAt ? (
              <Banner tone="info" title="Set your points rates first">
                <p>
                  Choose earn/redeem rates for {data.currencyCode}, save, then
                  run the 60-day order import below so historical customers get
                  the correct balances.
                </p>
              </Banner>
            ) : null}

            {actionData?.ok &&
            actionData.intent === "backfill_orders" &&
            "result" in actionData ? (
              <Banner tone="success" title="60-day order backfill complete">
                <p>
                  Scanned {actionData.result.scanned} · Awarded{" "}
                  {actionData.result.awarded} · Skipped{" "}
                  {actionData.result.skipped}
                  {actionData.result.errors.length > 0
                    ? ` · ${actionData.result.errors.length} errors`
                    : ""}
                </p>
              </Banner>
            ) : null}

            <PointsRateSection
              store={data.store}
              currencyCode={data.currencyCode}
              currencyLabel={data.currencyLabel}
            />
            <HistoricalImportSection
              backfillCompletedAt={data.backfillCompletedAt}
            />
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
