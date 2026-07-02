import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
  useBreakpoints,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getStoreByDomain } from "../lib/store.server";
import { getSupabaseAdmin } from "../lib/supabase.server";

interface CustomerRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier_name: string | null;
  total_spend: number;
  order_count: number;
  balance: number;
  last_activity_at: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getStoreByDomain(session.shop);

  if (!store) {
    return { customers: [] as CustomerRow[] };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("store_customers_list", {
    p_store_id: store.id,
  });

  if (error) {
    throw new Error(`customers list failed: ${error.message}`);
  }

  return { customers: (data as CustomerRow[]) ?? [] };
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

export default function CustomersIndex() {
  const { customers } = useLoaderData<typeof loader>();
  const breakpoints = useBreakpoints();

  if (customers.length === 0) {
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
    </Page>
  );
}
