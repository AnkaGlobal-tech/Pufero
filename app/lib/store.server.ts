import { getSupabaseAdmin } from "./supabase.server";
import { captureException } from "./sentry.server";

export interface StoreRecord {
  id: string;
  shop_domain: string;
  is_active: boolean;
  program_paused: boolean;
  installed_at: string | null;
  uninstalled_at: string | null;
  shopify_shop_id: number | null;
  name: string | null;
}

/**
 * On install / re-install, upsert the shop into `stores`.
 * First install calls `seed_store_defaults()` for default tiers/rules/redemptions.
 *
 * Re-install preserves existing data; only sets is_active=true, uninstalled_at=NULL,
 * and updates installed_at.
 */
export async function upsertStoreOnInstall(params: {
  shopDomain: string;
}): Promise<StoreRecord> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: existing, error: selectError } = await supabase
    .from("stores")
    .select("id, installed_at")
    .eq("shop_domain", params.shopDomain)
    .maybeSingle();

  if (selectError) {
    throw new Error(`stores select failed: ${selectError.message}`);
  }

  const isFirstInstall = !existing;

  const { data: store, error: upsertError } = await supabase
    .from("stores")
    .upsert(
      {
        shop_domain: params.shopDomain,
        is_active: true,
        program_paused: false,
        uninstalled_at: null,
        installed_at: existing?.installed_at ?? now,
      },
      { onConflict: "shop_domain" },
    )
    .select(
      "id, shop_domain, is_active, program_paused, installed_at, uninstalled_at, shopify_shop_id, name",
    )
    .single();

  if (upsertError || !store) {
    throw new Error(
      `stores upsert failed: ${upsertError?.message ?? "no row"}`,
    );
  }

  if (isFirstInstall) {
    const { error: seedError } = await supabase.rpc("seed_store_defaults", {
      p_store_id: store.id,
    });

    if (seedError) {
      captureException(seedError, {
        scope: "seed_store_defaults",
        shop_domain: params.shopDomain,
      });
    }
  }

  return store as StoreRecord;
}

/**
 * Uninstall webhook: deactivate store. Data is retained — GDPR webhooks handle deletion.
 */
export async function deactivateStoreOnUninstall(params: {
  shopDomain: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("stores")
    .update({
      is_active: false,
      program_paused: true,
      uninstalled_at: new Date().toISOString(),
    })
    .eq("shop_domain", params.shopDomain);

  if (error) {
    throw new Error(`stores deactivate failed: ${error.message}`);
  }
}

/** Admin loaders: return existing store or provision on first access (install race fallback). */
export async function getOrEnsureStoreByDomain(
  shopDomain: string,
): Promise<StoreRecord> {
  const existing = await getStoreByDomain(shopDomain);
  if (existing) {
    return existing;
  }
  return upsertStoreOnInstall({ shopDomain });
}

export async function getStoreByDomain(
  shopDomain: string,
): Promise<StoreRecord | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, shop_domain, is_active, program_paused, installed_at, uninstalled_at, shopify_shop_id, name",
    )
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (error) {
    throw new Error(`stores fetch failed: ${error.message}`);
  }

  return (data as StoreRecord | null) ?? null;
}
