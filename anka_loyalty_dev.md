# Anka Loyalty — Geliştirme Dokümantasyonu

> Shopify mağazaları için white-label sadakat programı uygulaması.
> App Store'da yayınlanmaz — Shopify Partner hesabından her müşteri mağazasına custom app olarak kurulur. Tek codebase, tek sunucu, multi-tenant. Bu doküman Cursor/Claude ile adım adım geliştirme sürecinin ana referansıdır.

---

## 1. Teknoloji Stack'i

| Katman | Teknoloji | Not |
|---|---|---|
| Framework | **Remix** (`@shopify/shopify-app-remix`) | Shopify resmi template; OAuth, session, webhook HMAC hazır |
| Admin UI | **Polaris** (embedded) | Mağaza sahibi paneli Shopify admin içinde çalışır |
| Veritabanı | **Supabase** (PostgreSQL + RLS) | Multi-tenant, `store_id` izolasyonu |
| Sunucu | **Railway** | Deploy hedefi |
| E-posta | **Klaviyo** (mağazanın kendi hesabı) | Uygulama mail göndermez — event push eder, mağaza flow'larını Klaviyo'da kurar |
| Hata takibi | **Sentry** | Webhook fail görünürlüğü |

**Mimari kararlar:**
- Mağaza sahibi admin paneli **embedded** (Polaris, Shopify admin içinde). Süper admin paneli ayrı standalone route.
- White-label algısı son müşterinin gördüğü widget'tadır — widget %100 markaya özel.
- Faturalandırma uygulama dışında, şirket tarafından manuel yürütülür — ödeme altyapısı kurulmaz.
- Klaviyo entegrasyonu, çekirdek uygulama tamamen çalışır hale geldikten sonra **en son** geliştirilir. O güne kadar tüm event'ler `klaviyo_events` tablosunda loglanır — entegrasyon açılınca geriye dönük kayıpsız akıtılır.

---

## 2. Puan Kazanma Senaryoları

### Satın Alma Puanları
- **$1 harcama = X puan** — oran tamamen mağaza bazında ayarlanabilir
- **İlk sipariş bonusu:** +100 puan
- **2. sipariş bonusu:** +150 puan
- **3. sipariş bonusu:** +200 puan
- **Bulk sipariş bonusu:** $1.200+ siparişlerde ekstra bonus puan

### Etkileşim Puanları
- **Yazılı yorum:** +50 puan (Judge.me, otomatik)
- **Fotoğraflı yorum:** +150 puan (otomatik)
- **UGC video:** +700–1.000 puan (admin panelinden manuel onay)
- **Referral:** +400 puan — davet edilen ilk siparişini verdiğinde
- **Hesap oluşturma:** +50 puan
- **Doğum günü:** +100 puan (yıllık)

### Bonus Puan Kampanyaları
- Mağaza panelden tarih aralıklı çarpan kampanyası kurar: "Hafta sonu 2x puan", "Black Friday 3x"
- Kurgu: ad + başlangıç/bitiş tarihi + çarpan (1.5x/2x/3x) + opsiyonel koleksiyon filtresi
- Kampanya aktifken puan motoru çarpanı otomatik uygular
- Duyuruyu mağaza kendisi yapar — kopyalanabilir duyuru metni şablonu sunulur; Klaviyo bağlıysa `anka_campaign_started` event'i de gider

### Exclusions (Puan Hariç Tutma)
- Mağaza belirli ürünleri/koleksiyonları puan kazanımından hariç tutabilir (sale ürünleri, gift card vb.)

### Expiry (Puan Son Kullanma)
- Mağaza ayarı: puanlar son hareketten X ay sonra yanar (6/12/24 ay veya kapalı)
- Yanmadan 30 gün ve 7 gün önce Klaviyo event'i tetiklenir
- Yanan puanlar ledger'a `expired` hareketi olarak işlenir

> Tüm puan değerleri, bonuslar ve kurallar mağaza panelinden özelleştirilebilir.

---

## 3. Sipariş İptali & İade Senaryoları

| Senaryo | Webhook | Puan Davranışı |
|---|---|---|
| **Tam iade** | `refunds/create` | Siparişten kazanılan puanların tamamı `refund_reversal` hareketiyle geri alınır |
| **Kısmi iade** | `refunds/create` | İade tutarına orantılı puan geri alınır ($50 siparişin $20'si iade → 20 puanlık kısım silinir) |
| **Sipariş iptali** | `orders/cancelled` | Tüm puanlar `cancel_reversal` ile silinir; sipariş sırası bonusu verildiyse geri alınır, sipariş sayacı düzeltilir |
| **Ödeme başarısız/voided** | `orders/cancelled` (financial_status kontrolü) | Puan verilmemişse işlem yok; verilmişse iptal akışı çalışır |

### Negatif Bakiye Kuralı
- Müşteri puanını harcadıktan sonra sipariş iptal/iade olursa bakiye negatife düşebilir — ledger destekler
- Negatif bakiye, yeni kazanılan puanlarla önce kapanır
- Admin panelinde negatif bakiyeli müşteriler ayrı filtreyle listelenir, mağaza manuel sıfırlayabilir

### Bonus & Tier Düzeltmesi
- İptal/iade sonrası toplam harcama yeniden hesaplanır — tier eşiğinin altına düştüyse tier ve Shopify tag'i otomatik güncellenir

---

## 4. VIP Tier Sistemi

| Tier | Koşul | Avantajlar |
|---|---|---|
| 🥉 Bronze | Kayıt ile | Puan kazanma, standart oranlar |
| 🥈 Silver | $500+ toplam harcama | %5 sürekli indirim, 1.25x puan çarpanı |
| 🥇 Gold | $1.500+ toplam harcama | %10 sürekli indirim, 1.5x puan çarpanı, erken erişim |
| 💎 Certified Pro | $5.000+ veya bulk müşteri | %15 indirim, 2x puan, lead yönlendirme, contractor listing, öncelikli destek |

- Eşikler ve avantajlar mağaza bazında özelleştirilebilir
- Tier düşürme: 12 ay hareketsizlikte bir alt tier (opsiyonel, mağaza ayarı)
- Certified Pro manuel atanabilir (B2B müşteriler)

**Tier indirimi (MVP):** Müşteriye otomatik tier tag'i atanır (`anka-tier-gold`). Shopify'da tag bazlı automatic discount kurulur — onboarding sihirbazı adım adım gösterir.

---

## 5. Puan Harcama (Redemption)

### Puan Değeri — Mağaza Kontrolünde
- Mağaza puanın dolar karşılığını kendisi belirler: "100 puan = $1", "200 puan = $1" — serbest oran
- Bu oran kupon kademelerinin ve sepet slider'ının temelidir
- Oran değişikliği geçmişi etkilemez, yeni harcamalarda geçerli olur

### Kupon Kademeleri — Mağaza Kendisi Kurar
- İstediği kadar kademe: örn. 500 puan = $5, 1.000 puan = $12, 2.500 puan = $35
- Tipler: sabit tutar / yüzde / ücretsiz kargo / ücretsiz ürün (mağaza ürünü seçer)
- Varsayılan şablon kademeler hazır gelir, mağaza düzenler veya siler
- Kuponlar Shopify Discount API ile otomatik üretilir — tek kullanımlık, müşteriye özel

### Sepette Puan Harcama Slider'ı
- Cart drawer/sepette slider: müşteri puanını kaydırarak anlık indirime çevirir
- Mağazanın puan/dolar oranını kullanır; min/max harcama limiti konabilir
- Slider kupon kodunu otomatik üretip sepete uygular
- Mağaza panelden aç/kapa yapar, Online Store'da app embed olarak aktive eder

---

## 6. Storefront Sayfa Yapısı (Müşterinin Gördüğü)

```
├── Launcher button (sağ alt, renk/ikon özelleştirilebilir)
│   └── Nudge/teaser balonu — "200 puanın var! 💰" (metin + aç/kapa admin'den)
├── Widget paneli (açılır)
│   ├── Üye değilse: program tanıtımı + kayıt CTA
│   └── Üyeyse: puan bakiyesi, tier progress bar, Kazan/Harca sekmeleri, referral linki
├── /pages/rewards — Loyalty Landing Page
│   ├── Program anlatımı, tier karşılaştırma tablosu, SSS
│   └── SEO'lu sayfa — hazır şablon olarak mağazaya verilir
├── Hesabım → Ödüllerim
│   ├── Puan geçmişi (kazanılan/harcanan/iptal-iade düzeltmesi/yanan)
│   ├── Aktif kuponlarım
│   ├── Tier yolculuğu görseli
│   └── Davet ettiklerim
├── Sepet → Puan harcama slider'ı (mağaza açarsa)
└── Referral Landing Page — "Arkadaşın sana %10 indirim gönderdi" + kayıt CTA
```

---

## 7. Klaviyo Entegrasyonu

Uygulama kendi başına mail göndermez. Aşağıdaki event'ler mağazanın Klaviyo hesabına push edilir; mağaza hangi event'e hangi maili/flow'u bağlayacağını Klaviyo'da kendisi seçer:

| Event | Tetikleyici |
|---|---|
| `anka_points_earned` | Puan kazanımı (sipariş/review/referral/manuel) |
| `anka_tier_upgraded` / `anka_tier_downgraded` | Tier değişimi |
| `anka_points_expiring_30d` / `anka_points_expiring_7d` | Yanma hatırlatmaları |
| `anka_birthday_points` | Doğum günü puanı |
| `anka_campaign_started` | Bonus kampanya duyurusu |
| `anka_points_reversed` | İptal/iade puan düzeltmesi |

### Profile Property Sync
- Müşterinin **puan bakiyesi** ve **tier'ı** Klaviyo profile property olarak sync edilir (`anka_points_balance`, `anka_tier`)
- Mağaza bu property'lerle segment kurabilir: "Gold üyelere özel kampanya", "1.000+ puanı olanlara hatırlatma"
- Sync: her bakiye/tier değişiminde güncellenir

### Kurulum Akışı
- Mağaza, admin panelindeki Entegrasyonlar sayfasından kendi Klaviyo API key'ini bağlar
- Event listesi + flow kurulum rehberi panelde sunulur
- Entegrasyon kurulana kadar event'ler `klaviyo_events` tablosunda birikir — açılınca geriye dönük akıtılır

---

## 8. Embedded Admin Sayfa Yapısı (Mağaza Sahibi — Polaris)

```
├── Dashboard
│   ├── Toplam üye, aktif üye, dağıtılan/harcanan puan
│   ├── Loyalty üyesi AOV vs üye olmayan AOV
│   ├── Tier dağılım grafiği
│   └── Son aktiviteler akışı
├── Program
│   ├── Earning Rules — puan oranı, bonuslar aç/kapa + miktar
│   ├── Redemption — puan/dolar oranı + kupon kademeleri CRUD
│   ├── Tiers — eşikler ve avantajlar
│   ├── Kampanyalar — bonus çarpan kampanyası oluştur/aktive et
│   └── Exclusions — ürün/koleksiyon hariç tutma (resource picker)
├── Müşteriler
│   ├── Üye listesi, arama, tier + negatif bakiye filtreleri
│   ├── Manuel puan ekleme/çıkarma (UGC onayı)
│   └── Müşteri detay: puan geçmişi, sipariş geçmişi, tier
├── Görünüm
│   ├── Widget rengi, konumu, logosu
│   ├── Nudge balonu metni + aç/kapa
│   ├── Sepet slider'ı aç/kapa + min/max limitler
│   └── Metin özelleştirme (TR/EN)
├── Entegrasyonlar
│   ├── Judge.me bağlantısı
│   └── Klaviyo — API key + event listesi + flow rehberi
├── Raporlar
│   ├── Aylık loyalty performans raporu
│   ├── ROI: program maliyeti vs loyalty kaynaklı gelir
│   └── CSV export
└── Ayarlar
    ├── Puan expiry süresi
    └── Program durdur/başlat
```

---

## 9. Süper Admin (Sadece Biz — Standalone)

```
├── Mağazalar listesi + sağlık durumu (webhook fail uyarıları)
├── Mağaza başına kullanım istatistikleri
├── Onboarding sihirbazı (custom app kaydı → API key → tag discount → widget aktive)
├── Mağaza paket/durum takibi
└── Global metrikler
```

---

## 10. Tasarım & Renk Paleti

### Uygulama Kimliği
| Renk | Hex | Kullanım |
|---|---|---|
| Koyu Lacivert | `#0F1B2D` | Ana arkaplan, header |
| Altın | `#C9A84C` | Vurgu, tier ikonları, CTA |
| Beyaz Kırık | `#F7F5F0` | İçerik arkaplanı |
| Yeşil | `#2D9B6E` | Başarı durumları, puan kazanımı |
| Gri | `#6B7280` | İkincil metin |

### Tier Renkleri
Bronze `#B0793F` · Silver `#A8B0BD` · Gold `#D4A937` · Certified Pro `#1B4F9C`

### Tipografi
- Başlıklar/Gövde: **Inter** · Sayılar/puanlar: **JetBrains Mono** (tabular)

> Widget tarafında her mağaza kendi marka rengini seçebilir — bu palet admin paneli ve varsayılan görünüm içindir.

---

## 11. Teknik Mimari & İlkeler

```
┌─────────────────────────────────────────────┐
│  Remix App (Railway)                        │
│  ├── Embedded Admin (Polaris, App Bridge)   │
│  ├── Storefront Widget (app embed)          │
│  ├── Müşteri Portalı                        │
│  ├── Webhook handler'lar                    │
│  └── Süper Admin (standalone route)         │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Supabase (PostgreSQL)                      │
│  ├── stores (multi-tenant)                  │
│  ├── customers, points_ledger (append-only) │
│  ├── tiers, rules, redemptions              │
│  ├── campaigns, exclusions, expiry_jobs     │
│  ├── webhook_events (idempotency)           │
│  ├── klaviyo_events (event log)             │
│  └── RLS (store_id izolasyonu)              │
└──────┬───────────────────────────┬──────────┘
       │                           │
┌──────▼──────────────────┐  ┌─────▼───────────────┐
│  Shopify (custom app)   │  │  Klaviyo (en son)   │
│  ├── orders/create      │  │  ├── Event push     │
│  ├── orders/cancelled   │  │  └── Profile sync   │
│  ├── refunds/create     │  │     (balance+tier)  │
│  ├── GDPR webhooks (x3) │  └─────────────────────┘
│  ├── Discount API       │
│  ├── Customer API + tag │
│  └── App Embed (widget) │
└─────────────────────────┘
```

### Teknik İlkeler
- **Points ledger append-only:** Bakiye tek kolonda tutulmaz — her hareket (earn / redeem / refund_reversal / cancel_reversal / expired / manual) ayrı satır, bakiye hesaplanır.
- **Webhook idempotency:** `X-Shopify-Webhook-Id` dedupe — çift puan engellenir.
- **Webhook güvenilirliği:** Kuyruk + retry, fail'ler Sentry'ye loglanır.
- **GDPR webhook'ları zorunlu:** `customers/data_request`, `customers/redact`, `shop/redact` — Hafta 1'de kurulur.
- **İptal/iade bütünlüğü:** Bölüm 3'teki tüm senaryolar; bonus ve tier düzeltmeleri otomatik.
- **Klaviyo event log:** Entegrasyon öncesi event'ler `klaviyo_events`'te birikir, kayıp olmaz.

---

## 12. AI Destekli Çalışma Protokolü

Bu plan Cursor/Claude ile gün gün ilerlemek üzere tasarlanmıştır:

1. **Günlük akış:** Her gün o günün maddeleri sırayla yapılır. Gün başında AI o günün maddelerini özetler ve sorar: *"Bu günün maddelerine eklemek istediğiniz bir şey var mı?"*
2. **Madde raporu:** Her madde tamamlandığında AI şu formatta rapor verir:
   - ✅ **Yapılan:** Ne eklendi, hangi dosyalar oluştu/değişti
   - ➕ **Eklenenler:** Plan dışı eklenenler ve sebebi
   - ➖ **Çıkarılanlar/Ertelenenler:** Neyin neden yapılmadığı/ertelendiği
   - ⚠️ **Dikkat:** Sonraki maddeyi etkileyecek notlar
3. **Faz geçişi:** Sonraki güne/haftaya yalnızca kullanıcı *"sonraki faza geç"* dediğinde geçilir. AI kendiliğinden ilerlemez.
4. **Kapsam koruması:** Plan dışı büyük özellik talepleri mevcut güne sıkıştırılmaz — dokümanın sonundaki "Eklenebilecekler" listesine not edilir.

---

## 13. Geliştirme Planı — 4 Hafta / 20 Gün

### HAFTA 1 — Temel Altyapı

**Gün 1 — Kurulum & İskelet**
- [ ] Shopify Partner hesabında ilk custom app kaydı (dev store ile)
- [x] Remix app scaffold (`@shopify/shopify-app-remix` template)
- [ ] GitHub repo + Railway deploy pipeline
- [ ] Supabase projesi + env değişkenleri
- [ ] Sentry kurulumu
- [ ] "Hello world" embedded sayfanın Shopify admin'de açıldığının doğrulanması

**Gün 2 — Veritabanı Şeması**
- [ ] Supabase şema: `stores`, `customers`, `points_ledger` (append-only), `rules`, `tiers`, `redemptions`, `campaigns`, `exclusions`, `webhook_events`, `klaviyo_events`
- [ ] Hareket tipleri: earn / redeem / refund_reversal / cancel_reversal / expired / manual
- [ ] RLS politikaları (store_id izolasyonu)
- [ ] Seed data + şema dokümantasyonu

**Gün 3 — OAuth & Kurulum Akışı**
- [ ] Custom app OAuth flow + session storage
- [ ] Install sonrası `stores` tablosuna otomatik kayıt
- [ ] Uninstall webhook + temizlik akışı

**Gün 4 — Webhook Altyapısı**
- [ ] `orders/create`, `orders/cancelled`, `refunds/create` + HMAC doğrulama
- [ ] GDPR webhook'ları: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] Idempotency (`X-Shopify-Webhook-Id` dedupe)
- [ ] Retry kuyruğu + Sentry fail loglama

**Gün 5 — Puan Motoru Çekirdeği**
- [ ] Temel puan hesaplama: $1 = X puan (mağaza ayarından)
- [ ] Sipariş → ledger kaydı uçtan uca test
- [ ] İptal/iade akışları: tam iade, kısmi iade (orantılı), sipariş iptali, negatif bakiye
- [ ] Test mağazasında kurulum + gerçek sipariş + iptal/iade testi
- 📋 **Hafta 1 raporu:** Webhook→puan→iptal/iade akışları çalışır durumda

---

### HAFTA 2 — Kurallar, Tier & Redemption

**Gün 6 — Bonus Kuralları Motoru**
- [ ] İlk/2./3. sipariş bonusları
- [ ] Bulk sipariş bonusu ($1.200+ eşiği)
- [ ] Hesap oluşturma + doğum günü puanları
- [ ] Kural aç/kapa + miktar ayarı altyapısı
- [ ] İptalde bonus geri alma + sipariş sayacı düzeltme

**Gün 7 — Review & Manuel Puan**
- [ ] Judge.me webhook entegrasyonu (yazılı +50 / fotoğraflı +150)
- [ ] Manuel puan ekleme/çıkarma servisi (UGC onayı)
- [ ] Ledger kaynak etiketleme (purchase/review/manual/referral)

**Gün 8 — Tier Sistemi**
- [ ] Tier hesaplama (toplam harcama) + otomatik geçiş
- [ ] Tier tag atama (`anka-tier-silver` vb.) — Customer API
- [ ] Tag bazlı automatic discount kurulum rehberi (onboarding adımı)
- [ ] Tier düşürme kuralı (12 ay hareketsizlik, opsiyonel)
- [ ] Tier puan çarpanları (1.25x/1.5x/2x)
- [ ] İptal/iade sonrası harcama yeniden hesaplama → tier + tag düzeltme

**Gün 9 — Redemption**
- [ ] Puan/dolar oranı ayarı (mağaza belirler: 100 puan = $1 vb.)
- [ ] Kupon kademeleri CRUD (sabit/yüzde/kargo/ürün)
- [ ] Shopify Discount API — tek kullanımlık, müşteriye özel kupon üretimi
- [ ] Puan düşme + kupon üretme transaction bütünlüğü

**Gün 10 — Expiry & Kampanyalar**
- [ ] Puan expiry sistemi (mağaza ayarı + scheduled job + `expired` kaydı)
- [ ] Expiry event üretimi (30/7 gün — `klaviyo_events` log'una)
- [ ] Bonus kampanya motoru: tarih aralığı + çarpan + koleksiyon filtresi
- [ ] Kampanya aktifken çarpan uygulaması
- [ ] Exclusions kontrolü puan motorunda
- 📋 **Hafta 2 raporu:** Tüm kazanma/harcama/iptal senaryoları backend'de çalışır

---

### HAFTA 3 — Arayüzler

**Gün 11 — Embedded Admin: İskelet & Dashboard**
- [ ] Polaris layout + navigasyon (Dashboard/Program/Müşteriler/Görünüm/Entegrasyonlar/Raporlar/Ayarlar)
- [ ] Dashboard: üye sayıları, puan akışı, tier dağılımı, son aktiviteler

**Gün 12 — Admin: Program Yönetimi**
- [ ] Earning Rules sayfası (oran + bonuslar)
- [ ] Redemption: puan/dolar oranı + kademe CRUD ekranı
- [ ] Tiers düzenleme
- [ ] Kampanya oluşturma/aktive + kopyalanabilir duyuru metni
- [ ] Exclusions resource picker
- [ ] Müşteriler: liste, filtreler (tier + negatif bakiye), manuel puan, detay

**Gün 13 — Storefront Widget**
- [ ] App embed: launcher button (renk/konum/ikon)
- [ ] Nudge/teaser balonu (metin + aç/kapa)
- [ ] Widget paneli: bakiye, tier bar, Kazan/Harca sekmeleri, tek tıkla kupon
- [ ] Üye olmayan görünümü + kayıt CTA

**Gün 14 — Müşteri Portalı & Landing**
- [ ] Hesabım → Ödüllerim (puan geçmişi — düzeltmeler dahil, kuponlar, tier yolculuğu, referral)
- [ ] /pages/rewards landing page şablonu (tier tablosu + SSS)
- [ ] Görünüm ayarları sayfası (widget özelleştirme, TR/EN)

**Gün 15 — Sepet Slider'ı**
- [ ] Cart drawer/sepet slider'ı (app embed)
- [ ] Puan/dolar oranıyla dönüşüm + min/max limitler
- [ ] Slider → kupon üretimi → sepete uygulama
- [ ] Admin'den aç/kapa + Online Store aktive rehberi
- 📋 **Hafta 3 raporu:** Tüm arayüzler çalışır, uçtan uca deneyim test edilebilir

---

### HAFTA 4 — Tamamlama & Pilot

**Gün 16 — Referral Sistemi**
- [ ] Referral link üretimi + takip
- [ ] Çift taraflı ödül: davet eden +400 puan, davet edilen %10 indirim
- [ ] Referral landing page
- [ ] Fraud koruması: müşteri başına referral limiti

**Gün 17 — Süper Admin & Onboarding**
- [ ] Standalone süper admin: mağaza listesi + webhook sağlık durumu
- [ ] Onboarding sihirbazı (custom app kaydı → API key → tag discount → widget aktive)
- [ ] Mağaza paket/durum takibi ekranı

**Gün 18 — Raporlar & Judge.me Ekranı**
- [ ] Raporlar: aylık performans + ROI + CSV export
- [ ] Judge.me bağlantı ekranı
- [ ] Edge-case taraması: çifte webhook, eşzamanlı redemption, negatif bakiye uçları

**Gün 19 — Klaviyo Entegrasyonu (En Son)**
- [ ] Klaviyo API key bağlama ekranı
- [ ] Event push servisi: `klaviyo_events` log'undaki tüm event'lerin akıtılması
- [ ] Profile property sync: `anka_points_balance` + `anka_tier` (her değişimde güncellenir)
- [ ] Event listesi + flow kurulum rehberi (panelde)
- [ ] Test: puan kazanımı → event → flow tetiklenme + property sync doğrulaması

**Gün 20 — Pilot & Lansman**
- [ ] ixirpro.com'a pilot kurulum
- [ ] Uçtan uca testler: sipariş→puan, iptal→geri alma, kısmi iade, review→puan, redemption, slider, kampanya, expiry, Klaviyo event + property sync
- [ ] Bug fix + performans kontrolü
- [ ] Lansman checklist'i + mağaza sahibi kullanım dokümanı
- 📋 **Final rapor:** Canlı pilot, bilinen sınırlamalar, eklenebilecekler listesi güncellemesi

---

## 14. Eklenebilecekler (Kapsam Dışı — Sonradan Değerlendirilecek)

> Bu liste geliştirme sırasında not alınan ve sonradan eklenebilecek özellikleri içerir. Plan dışı talepler buraya eklenir.

- Shopify Functions ile tam otomatik tier indirimi (tag yöntemi yerine)
- WhatsApp bildirimleri (WhatsApp Business API)
- Mailchimp entegrasyonu
- Aylık ROI raporu otomatik maili (mağaza sahibine)
- Puan kazanma konfeti animasyonu (teşekkür sayfası)
- Misafir müşteriye puan teaser'ı ("Bu siparişten 85 puan kazanırdın")
- Unlisted public app'e geçiş — pilot 10-20 mağazada oturduktan sonra App Store dışı dağıtım, gerçek SaaS

<!-- Eren: yeni eklemeler buraya -->
