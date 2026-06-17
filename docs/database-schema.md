# Veritabani Semasi

> Proje: **Anka Loyalty** (`geakermzkpmflpqwpghc`) · Supabase PostgreSQL · Multi-tenant (`store_id`)

Migration dosyalari: [`supabase/migrations/`](../supabase/migrations/)

## Ilkeler

- **Multi-tenant:** Tum tenant tablolarinda `store_id` foreign key.
- **Puan bakiyesi:** `customers` tablosunda tutulmaz; `points_ledger` uzerinden `SUM(points)` ile hesaplanir.
- **Append-only ledger:** `points_ledger` uzerinde UPDATE/DELETE trigger ile engellenir.
- **RLS:** Tum tablolarda acik. Remix sunucusu `service_role` kullanir (RLS bypass). `authenticated` rolu icin `store_id` JWT claim politikasi hazir.
- **Yeni magaza:** `seed_store_defaults(store_id)` fonksiyonu varsayilan tier, kural ve redemption kademelerini olusturur.

## Tablolar

### `stores`
Magaza tenant kaydi. Shopify `shop_domain` unique.

| Onemli kolonlar | Aciklama |
|---|---|
| `shop_domain` | `xxx.myshopify.com` |
| `points_per_dollar` | $1 basina puan (varsayilan 1) |
| `points_to_dollar_ratio` | 100 puan = $1 (varsayilan) |
| `points_expiry_months` | 6 / 12 / 24 / NULL (kapali) |
| `program_paused` | Program durdurma |

### `customers`
Loyalty uyeleri. `shopify_customer_id` magaza bazinda unique.

### `points_ledger`
Append-only puan hareketleri.

**`ledger_movement_type`:** `earn` · `redeem` · `refund_reversal` · `cancel_reversal` · `expired` · `manual`

**`ledger_source`:** `purchase` · `review_text` · `review_photo` · `ugc_video` · `referral` · `manual` · `campaign` · `birthday` · `account_creation` · `first_order_bonus` · `second_order_bonus` · `third_order_bonus` · `bulk_order_bonus`

### `rules`
Magaza bazli kazanma kurallari. `rule_type` + `points_value` + `config` (JSON).

### `tiers`
VIP tier tanimlari. `shopify_customer_tag` otomatik tag atamasi icin (orn. `anka-tier-gold`).

### `redemptions`
Kupon kademeleri. `reward_type`: `fixed_amount` · `percentage` · `free_shipping` · `free_product`

### `campaigns`
Bonus carpani kampanyalari. `multiplier`, tarih araligi, opsiyonel `collection_ids`.

### `exclusions`
Puan haric tutulan urun/koleksiyonlar.

### `webhook_events`
Shopify webhook idempotency (`shopify_webhook_id` unique).

### `klaviyo_events`
Klaviyo entegrasyonu oncesi event log. `synced_at IS NULL` = henuz akitilmamis.

### `expiry_jobs`
Puan yanma zamanlayicisi ve hatirlatma durumu.

## Yardimci fonksiyonlar

| Fonksiyon | Aciklama |
|---|---|
| `customer_points_balance(uuid)` | Musteri puan bakiyesi |
| `seed_store_defaults(uuid)` | Varsayilan tier/kural/redemption seed |

## Seed (dev store)

`anka-loyalt-dev.myshopify.com` icin:

- 4 tier (Bronze → Certified Pro)
- 11 earning rule (dokumandaki varsayilan degerler)
- 3 redemption kademesi ($5 / $12 / $35)

## TypeScript

Enum tipleri: [`app/types/loyalty.ts`](../app/types/loyalty.ts)

Tam Supabase client tipleri: MCP `generate_typescript_types` veya `supabase login` sonrasi CLI ile uretilebilir.
