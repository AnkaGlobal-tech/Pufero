# Multi-Brand Deployment — Fork & White-Label Rehberi

> **Amaç:** AnkaGlobal Partner hesabı altında her marka için ayrı Shopify custom app kurmak; kod tabanını mümkün olduğunca **marka-bağımsız** tutarak fork başına minimum değişiklik yapmak.
>
> **Pilot marka:** ixirpro → görünen isim: **THE REAL PROs** (app adı ve metinler sizden gelecek)

---

## 1. Mimari özeti

```
AnkaGlobal Partner Dashboard
├── App A: "Anka Loyalty"        → repo: anka-loyalty        → Railway service A ─┐
├── App B: "THE REAL PROs …"     → repo: realpros-loyalty    → Railway service B ─┼→ Supabase (paylaşımlı)
└── App C: …                     → repo: …                   → Railway service C ─┘
```

| Bileşen | Paylaşım | Not |
|---------|----------|-----|
| **Supabase** | ✅ Tek proje | `store_id` + `shop_domain` zaten tenant izolasyonu |
| **GitHub repo** | ❌ Marka başına fork | Pilot hızlı gider; 3+ markada tek repo + env hedeflenir |
| **Railway servisi** | ❌ Marka başına 1 servis | Her Shopify app’in kendi `client_id` / secret’i var |
| **Shopify Partner app** | ❌ Marka başına 1 app | Admin’de görünen isim white-label burada |
| **Klaviyo hesabı** | ❌ Mağazanın kendi hesabı | Metrik isimleri marka-bağımsız olursa flow şablonları kopyalanabilir |

**Kritik kural:** Aynı Railway servisine iki farklı Shopify app bağlanamaz (OAuth + webhook HMAC tek credential seti).

---

## 2. İsimlendirme — üç katman

Değişiklikleri üç gruba ayırın. Fork’ta yalnızca **Katman C**’ye dokunmak hedef.

### Katman A — Marka-bağımsız (base repo’da **bir kez** refactor, fork’ta **dokunma**)

Bunlar tüm markalarda **aynı string** kalır. İlk ixir fork’undan **önce** ana repoda neutralize edilmeli.

| Alan | Şu an (Anka) | Hedef (neutral) | Neden |
|------|--------------|-----------------|-------|
| Tier Shopify tag’leri | `anka-tier-gold` | `tier-gold` | Tier adı zaten Gold; marka prefix gereksiz |
| | `anka-tier-silver` | `tier-silver` | |
| | `anka-tier-bronze` | `tier-bronze` | |
| | `anka-tier-certified-pro` | `tier-certified-pro` | |
| Klaviyo metrikleri | `Anka Points Earned` | `Loyalty Points Earned` | Klaviyo flow şablonu markalar arası kopyalanır |
| | `Anka Loyalty Welcome` | `Loyalty Welcome` | |
| | `Anka Points Redeemed` | `Loyalty Points Redeemed` | |
| | `Anka Tier Changed` | `Loyalty Tier Changed` | |
| | `Anka Points Expiring Soon` | `Loyalty Points Expiring Soon` | |
| | `Anka Points Expired` | `Loyalty Points Expired` | |
| | `Anka Review Points Earned` | `Loyalty Review Points Earned` | |
| Klaviyo profile property | `anka_points_balance` | `loyalty_points_balance` | Email şablonları: `{{ person.loyalty_points_balance }}` |
| | `anka_tier` | `loyalty_tier` | |
| | `anka_tier_slug` | `loyalty_tier_slug` | |
| | `anka_loyalty_member` | `loyalty_member` | |
| | `anka_member_since` | `loyalty_member_since` | |
| Internal event queue adları | `anka_points_expiring_30d` | `loyalty_points_expiring_30d` | DB’deki eski satırlar flush sırasında map edilir |
| Referral cookie key | `anka_ref` | `loyalty_ref` | Storefront JS |
| App proxy subpath | `anka` | `loyalty` | URL: `/apps/loyalty/widget` — marka adı URL’de görünmez |
| Remix route dosyaları | `apps.anka.*.tsx` | `apps.loyalty.*.tsx` | Subpath ile eşleşmeli |
| Theme asset proxy URL | `/apps/anka/...` | `/apps/loyalty/...` | 6 adet `.js` dosyası |
| Extension UID / klasör | `anka-loyalty-widget` | `loyalty-widget` | Teknik isim; müşteri görmez |
| Kupon / discount title prefix | `Anka Loyalty —` | `Loyalty —` veya env | Shopify admin’de kupon listesi |
| Referral kupon title | `Anka Referral —` | `Referral —` | |

**Tier tag notu:** Sadece `gold` kullanmak mümkün ama Shopify mağazasında başka `gold` tag’leri varsa çakışır. **`tier-gold`** formatı önerilir — marka-bağımsız, çakışma riski düşük.

**App proxy notu:** Her marka ayrı Partner app olsa bile subpath’i **`loyalty`** sabit tutarsanız theme JS ve Remix route’ları fork’ta değişmez. Subpath’i markaya göre değiştirirseniz (`ixir`, `realpros`…) her fork’ta `shopify.app.toml` + 6 JS + ~10 route dosyası güncellenir.

---

### Katman B — Deploy / ortam (fork’ta **env + toml**, kodda az değişiklik)

| Alan | Nerede | Örnek (THE REAL PROs) |
|------|--------|------------------------|
| Shopify app adı | Partner Dashboard + `shopify.app.toml` → `name` | `THE REAL PROs Rewards` |
| `client_id` | Partner + `shopify.app.toml` | Yeni app’ten |
| `SHOPIFY_API_KEY` / `SECRET` | Railway env | Yeni app credentials |
| `SHOPIFY_APP_URL` | Railway env + `shopify.app.toml` `application_url` | `https://realpros-loyalty.up.railway.app` |
| Auth redirect URL’leri | `shopify.app.toml` `[auth]` | Railway URL ile aynı host |
| App proxy URL | `shopify.app.toml` `[app_proxy]` | `…/apps/loyalty` (subpath sabit kalırsa sadece host değişir) |
| `package.json` name | Opsiyonel | `realpros-loyalty` |
| Sentry DSN / proje | Railway env | Marka bazlı izolasyon (önerilir) |
| GitHub repo adı | GitHub | `realpros-loyalty` |

**Öneri:** İleride `BRAND_DISPLAY_NAME` env + tek `brand.config.ts` ile admin TitleBar, kupon prefix, test review metni dinamik okunabilir — fork’ta yalnızca env değişir.

---

### Katman C — Marka / mağaza özelleştirmesi (fork **değil**, **admin panelden**)

Bunlar için kod fork’u gerekmez; mağaza sahibi kurulum sonrası ayarlar.

| Alan | Nerede ayarlanır |
|------|------------------|
| Puan birimi adı (“points” / “PRO Points”) | Appearance → Widget i18n |
| Tier görünen isimleri (Bronze → Starter vb.) | Program → Tiers |
| Program SSS, landing metinleri | Widget i18n + tema sayfaları |
| Klaviyo API key + flow tasarımı | Klaviyo sekmesi + Klaviyo panel |
| Tier eşikleri, bonus kuralları | Program |
| Tema sayfaları (`/pages/rewards` vb.) | Shopify tema editörü |

---

## 3. Fork checklist — dosya dosya

Fork aldıktan sonra aşağıdaki tabloyu işaretleyin. **Katman A refactor yapıldıysa** “Değişir mi?” sütunundaki çoğu madde **Hayır** olur.

### 3.1 Zorunlu (her yeni marka)

- [ ] Partner Dashboard’da yeni custom app oluştur
- [ ] `shopify.app.toml` → `client_id`, `name`, `application_url`, `[auth]`, `[app_proxy].url`
- [ ] Railway: yeni servis, env (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`, Supabase keys)
- [ ] `shopify app deploy` (production app version)
- [ ] Mağazaya app kurulumu (install link)
- [ ] Supabase migration’ların production’da güncel olduğunu doğrula

### 3.2 Katman A yapılmadıysa — fork’ta manuel (kaçının)

| Dosya / alan | Değişir mi? | Not |
|--------------|-------------|-----|
| `supabase/migrations/*seed*` → `shopify_customer_tag` | Evet → `tier-*` | Yeni mağazalar seed’den doğru gelir |
| `app/lib/klaviyo-constants.ts` | Hayır (neutral) | |
| `app/lib/klaviyo-sync.server.ts` profile props | Hayır (neutral) | |
| `app/lib/expiry-engine.server.ts` event names | Hayır (neutral) | |
| `app/lib/referral-engine.server.ts` `REFERRAL_STORAGE_KEY` | Hayır (neutral) | |
| `app/routes/apps.loyalty.*.tsx` | Hayır | Route adı = proxy subpath |
| `extensions/loyalty-widget/assets/*.js` proxy paths | Hayır | `/apps/loyalty/...` |
| `shopify.app.toml` `[app_proxy].subpath` | Hayır | `loyalty` sabit |
| `app/routes/app._index.tsx` TitleBar | Evet (veya env) | `THE REAL PROs` |
| `app/lib/redemption.server.ts` discount title | Evet (veya env) | |
| `extensions/.../blocks/*.liquid` `"name"` schema | Evet | Theme editor’da görünen blok adı |
| `extensions/.../blocks/launcher.liquid` admin yönlendirme metni | Evet | “… admin → Appearance” |
| `package.json` / `package-lock.json` name | Opsiyonel | |
| `README.md`, `anka_loyalty_dev.md` | Opsiyonel | Ekip dokümanı |
| `app/routes/app.reports.tsx` fallback URL | Evet | Env set edilmezse hardcoded kalmasın |

### 3.3 Theme editor’da görünen isimler (Katman C + liquid schema)

Mağaza temasında blok adları markaya göre güzel görünsün diye liquid schema `name` alanları fork’ta güncellenir:

| Blok | Örnek isim (THE REAL PROs) |
|------|----------------------------|
| Launcher embed | `THE REAL PROs Rewards` |
| Account portal | `THE REAL PROs — My Rewards` |
| Rewards landing | `THE REAL PROs — Rewards Page` |
| Referral landing | `THE REAL PROs — Refer a Pro` |
| Cart slider | `THE REAL PROs — Cart Points` |

---

## 4. THE REAL PROs pilot — doldurulacak alanlar

> Bu bölümü siz doldurdukça fork checklist’e işlenir.

| Alan | Değer | Onay |
|------|-------|------|
| Mağaza domain | `ixirpro.myshopify.com` (?) | [ ] |
| Partner app adı | `THE REAL PROs Rewards` (?) | [ ] |
| Railway servis adı | `realpros-loyalty` (?) | [ ] |
| Railway URL | `https://….up.railway.app` | [ ] |
| GitHub repo | `AnkaGlobal-tech/realpros-loyalty` (?) | [ ] |
| Puan birimi (storefront) | `PRO Points` / `points` (?) | [ ] |
| Tier isimleri özelleştirme | Bronze/Silver/Gold → ? | [ ] |
| Klaviyo | Mağazanın kendi hesabı | [ ] |
| Judge.me | Var / yok | [ ] |

**Tier tag’leri (Katman A sonrası):** `tier-bronze`, `tier-silver`, `tier-gold`, `tier-certified-pro` — fork’ta değişmez.

**Klaviyo metrikleri (Katman A sonrası):** `Loyalty Welcome`, `Loyalty Points Earned`, … — fork’ta değişmez.

---

## 5. Yol haritası

### Faz 0 — Base repo neutralize ✅ *(uygulandı)*

Ana `anka-loyalty` reposunda Katman A tamamlandı:

1. ✅ Tier seed tag’leri → `tier-*` (migration: `20260708150000_neutral_brand_naming.sql`)
2. ✅ Klaviyo metrik + profile property → `Loyalty …` / `loyalty_*`
3. ✅ App proxy subpath → `loyalty`; route’lar `apps.loyalty.*`
4. ✅ Theme JS proxy URL’leri → `/apps/loyalty/...`
5. ✅ Extension klasör → `extensions/loyalty-widget`
6. ✅ Expiry queue + legacy Klaviyo map
7. ⏳ Deploy: Partner app proxy subpath + `shopify app deploy`
8. ⏳ Shopify customer tag’leri — bir sonraki tier sync’te `tier-*` olur

**Sonraki:** Push → GitHub fork → Bölüm 10 checklist.

### Faz 1 — THE REAL PROs fork & deploy (~0.5 gün)

1. GitHub: `anka-loyalty` → fork/copy → `realpros-loyalty`
2. Katman B checklist (toml, env, Railway servis)
3. Katman C liquid schema isimleri (`THE REAL PROs …`)
4. Partner’da app oluştur → `shopify app deploy`
5. ixirpro’ya kur

### Faz 2 — Mağaza kurulumu (~0.5 gün)

1. Program ayarları (puan oranı, tier, kurallar)
2. Appearance (widget i18n → “PRO Points” vb.)
3. Tema: embed’ler + `/pages/rewards`, `/pages/my-rewards`, `/pages/refer`
4. Klaviyo: connect → 60 gün backfill → welcome events → flow kur
5. Judge.me (varsa): token + webhook

### Faz 3 — Gün 20 test paketi

Uçtan uca: sipariş→puan, iptal/iade, redeem, slider, referral, review, Klaviyo property sync.

### Faz 4 — 2. marka ve sonrası

- Katman A tamamsa: yeni marka ≈ 2–4 saat (Partner app + Railway + liquid isimler)
- 3+ markada: tek repo + `BRAND_DISPLAY_NAME` env refactor değerlendir

---

## 6. Supabase paylaşım — dikkat edilecekler

| Konu | Durum |
|------|--------|
| `stores` tablosu | Her shop ayrı satır ✅ |
| `points_ledger`, `customers`, … | `store_id` izolasyonu ✅ |
| `shopify_sessions` (Prisma) | Tüm deploy’lar aynı tabloyu kullanır — farklı shop’lar için sorun yok ✅ |
| Migration | Tek pipeline; tüm Railway servisleri aynı schema ✅ |
| Yedek / restore | Tek proje — tüm markalar birlikte etkilenir ⚠️ |

---

## 7. Klaviyo — marka bağımsız flow şablonu

Katman A sonrası tüm markalarda aynı metrikler. Bir kez flow kurup diğer markaya **kopyalayabilirsiniz** (logo/metin değişir):

| Trigger metrik | Email’de kullanılacak değişkenler |
|----------------|-----------------------------------|
| `Loyalty Welcome` | `{{ person.loyalty_points_balance }}`, `{{ person.loyalty_tier }}`, event: `review_photo_points` |
| `Loyalty Points Earned` | `{{ event.points }}`, `{{ person.loyalty_points_balance }}` |
| `Loyalty Review Points Earned` | Photo review kampanyası CTA |
| `Loyalty Points Expiring Soon` | `{{ person.loyalty_points_balance }}` |

---

## 8. Hızlı karar özeti

| Soru | Öneri |
|------|--------|
| Tier tag’ler marka adı mı? | **Hayır** → `tier-gold`, `tier-silver` |
| Klaviyo metrikleri marka adı mı? | **Hayır** → `Loyalty Points Earned` |
| App proxy subpath marka adı mı? | **Hayır** → sabit `loyalty` |
| Remix route’ları fork’ta mı? | **Hayır** → `apps.loyalty.*` bir kez, hepsinde aynı |
| Shopify app adı marka adı mı? | **Evet** → `THE REAL PROs Rewards` |
| Railway servisi paylaşımlı mı? | **Hayır** → app başına 1 servis |
| Supabase paylaşımlı mı? | **Evet** → pilot için uygun |
| Puan birimi adı (“PRO Points”) | **Admin’den** → Widget i18n, fork gerekmez |

---

## 9. Sonraki adım

1. **Push** — bu commit’i `anka-loyalty` repo’suna gönderin.
2. **Fork** — GitHub’da `realpros-loyalty` oluşturun.
3. **Bölüm 10** — fork’ta yalnızca Katman B + C.
4. **THE REAL PROs tablosunu** (Bölüm 4) netleştirin.

---

## 10. Fork checklist — sadece Katman B + C

> Katman A base repo’da yapıldı. Yeni repoda **yalnızca** aşağıdakileri değiştirin.

### Katman B — Zorunlu

- [ ] Partner Dashboard → yeni custom app
- [ ] `shopify.app.toml` → `client_id`, `name`, `application_url`, `[auth]`, `[app_proxy].url` (host)
- [ ] Railway → yeni servis + env
- [ ] `shopify app deploy`

**Dokunmayın:** `subpath = "loyalty"`, `apps.loyalty.*`, Klaviyo metrikleri, tier tag’leri.

### Katman C — Marka metinleri

- [ ] `app/routes/app._index.tsx` → TitleBar marka adı
- [ ] `extensions/loyalty-widget/blocks/*.liquid` → schema `"name"`
- [ ] `app/routes/app.appearance.tsx` → embed rehberi
- [ ] Appearance → Widget i18n (PRO Points vb.)
- [ ] Tema sayfaları + embed’ler

---

*Son güncelleme: Faz 0 (Katman A) base repo'da uygulandı — fork için hazır.*
