import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ShopLocaleInfo {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}

const SHOP_LOCALES_QUERY = `#graphql
  query ShopLocales {
    shopLocales {
      locale
      name
      primary
      published
    }
  }
`;

/** Fetch published shop locales (for admin appearance page). */
export async function fetchShopLocales(
  admin: AdminApiContext,
): Promise<ShopLocaleInfo[]> {
  try {
    const response = await admin.graphql(SHOP_LOCALES_QUERY);
    const json = await response.json();
    const rows = (json.data?.shopLocales ?? []) as ShopLocaleInfo[];
    return rows.filter((r) => r.published);
  } catch (error) {
    console.error("[shop-locales] fetch failed:", error);
    return [{ locale: "en", name: "English", primary: true, published: true }];
  }
}

export function primaryLocale(locales: ShopLocaleInfo[]): string {
  const primary = locales.find((l) => l.primary);
  if (primary) {
    return primary.locale.split("-")[0].toLowerCase();
  }
  return locales[0]?.locale.split("-")[0].toLowerCase() ?? "en";
}
