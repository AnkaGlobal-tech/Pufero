import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
  useBreakpoints,
  Button,
  Select,
  Checkbox,
  InlineStack,
  BlockStack,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getSupabaseAdmin } from "../lib/supabase.server";
import { listStoreTiers } from "../lib/tier-engine.server";

interface CustomerRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier_name: string | null;
  tier_slug: string | null;
  total_spend: number;
  order_count: number;
  balance: number;
  last_activity_at: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return {
      customers: [] as CustomerRow[],
      tiers: [] as { slug: string; name: string }[],
      filters: { tier: "", negative: false },
    };
  }

  const url = new URL(request.url);
  const tierSlug = url.searchParams.get("tier")?.trim() || "";
  const negativeOnly = url.searchParams.get("negative") === "1";

  const supabase = getSupabaseAdmin();
  const [listRes, tiers] = await Promise.all([
    supabase.rpc("store_customers_list", {
      p_store_id: store.id,
      p_tier_slug: tierSlug || null,
      p_negative_balance: negativeOnly ? true : null,
    }),
    listStoreTiers(store.id),
  ]);

  if (listRes.error) {
    throw new Error(`customers list failed: ${listRes.error.message}`);
  }

  return {
    customers: (listRes.data as CustomerRow[]) ?? [],
    tiers,
    filters: { tier: tierSlug, negative: negativeOnly },
  };
};

const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function customerName(c: CustomerRow): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || "Unnamed customer";
}

function CustomerFilters(props: {
  tiers: { slug: string; name: string }[];
  filters: { tier: string; negative: boolean };
}) {
  const [tier, setTier] = useState(props.filters.tier);
  const [negative, setNegative] = useState(props.filters.negative);

  const tierOptions = [
    { label: "All tiers", value: "" },
    ...props.tiers.map((t) => ({ label: t.name, value: t.slug })),
  ];

  return (
    <Card>
      <Form method="get">
        <input type="hidden" name="tier" value={tier} />
        {negative ? <input type="hidden" name="negative" value="1" /> : null}
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm">
            Filters
          </Text>
          <InlineStack gap="400" wrap blockAlign="end">
            <Box minWidth="200px">
              <Select
                label="Tier"
                options={tierOptions}
                value={tier}
                onChange={setTier}
              />
            </Box>
            <Checkbox
              label="Negative balance only"
              checked={negative}
              onChange={setNegative}
            />
            <Button submit>Apply</Button>
            {props.filters.tier || props.filters.negative ? (
              <Button url="/app/customers">Clear</Button>
            ) : null}
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}

export default function CustomersIndex() {
  const { customers, tiers, filters } = useLoaderData<typeof loader>();
  const breakpoints = useBreakpoints();
  const hasFilters = Boolean(filters.tier || filters.negative);

  if (customers.length === 0 && !hasFilters) {
    return (
      <Page title="Customers">
        <TitleBar title="Customers" />
        <Card>
          <EmptyState
            heading="No members yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Customers will appear here automatically after their first order.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const rowMarkup = customers.map((c, index) => (
    <IndexTable.Row id={c.id} key={c.id} position={index}>
      <IndexTable.Cell>
        <Link to={`/app/customers/${c.id}`} prefetch="intent">
          <Text as="span" variant="bodyMd" fontWeight="medium">
            {customerName(c)}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {c.email ?? "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {c.tier_name ? (
          <Badge>{c.tier_name}</Badge>
        ) : (
          <Text as="span" tone="subdued">
            —
          </Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text
          as="span"
          variant="bodyMd"
          fontWeight="semibold"
          tone={c.balance < 0 ? "critical" : undefined}
          numeric
        >
          {numberFormatter.format(c.balance)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric>
          ${currencyFormatter.format(c.total_spend)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric>
          {c.order_count}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Link to={`/app/customers/${c.id}`}>
          <Button size="slim">Details</Button>
        </Link>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Customers"
      subtitle={`${numberFormatter.format(customers.length)} members`}
    >
      <TitleBar title="Customers" />
      <BlockStack gap="400">
        <CustomerFilters tiers={tiers} filters={filters} />

        {customers.length === 0 ? (
          <Card>
            <EmptyState
              heading="No customers match these filters"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Try changing tier or balance filters.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              condensed={breakpoints.smDown}
              itemCount={customers.length}
              selectable={false}
              headings={[
                { title: "Customer" },
                { title: "Email" },
                { title: "Tier" },
                { title: "Points balance" },
                { title: "Total spend" },
                { title: "Orders" },
                { title: "" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
