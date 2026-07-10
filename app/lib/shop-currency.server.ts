import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const SHOP_CURRENCY_QUERY = `#graphql
  query ShopCurrency {
    shop {
      currencyCode
      currencyFormats {
        moneyFormat
      }
    }
  }
`;

export async function getShopCurrencyCode(
  admin: AdminApiContext,
): Promise<string> {
  try {
    const response = await admin.graphql(SHOP_CURRENCY_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { currencyCode?: string } };
    };
    const code = json.data?.shop?.currencyCode?.trim();
    return code && code.length > 0 ? code : "USD";
  } catch {
    return "USD";
  }
}

/** Short label for UI: TRY → TL, USD → $, else currency code. */
export function currencyUnitLabel(currencyCode: string): string {
  const code = currencyCode.toUpperCase();
  if (code === "TRY") return "TL";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  if (code === "GBP") return "£";
  return code;
}
