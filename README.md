# Anka Loyalty

Shopify mağazaları için white-label sadakat programı uygulaması. App Store'da yayınlanmaz — her müşteri mağazasına custom app olarak kurulur. Tek codebase, tek sunucu, multi-tenant.

Detaylı plan ve mimari için: [`anka_loyalty_dev.md`](./anka_loyalty_dev.md)

## Stack

| Katman | Teknoloji |
|---|---|
| Framework | Remix (`@shopify/shopify-app-remix`) |
| Admin UI | Polaris (embedded) |
| Veritabanı | Supabase (PostgreSQL + RLS) |
| Deploy | Railway |
| E-posta | Klaviyo (event push) |
| Hata takibi | Sentry |

## Geliştirme

```bash
npm install
cp .env.example .env   # değerleri doldur
npm run dev            # shopify app dev (Partner hesabı login ister)
```

> Not: Session storage şu an template varsayılanı olan Prisma + SQLite. Gün 2-3'te Supabase'e taşınacak.

## Durum

Gün 1 (Kurulum & İskelet) — scaffold tamam. Shopify Partner / GitHub / Railway / Supabase hesapları beklendiği için app kaydı, deploy pipeline ve veritabanı bağlantısı henüz yapılmadı.

Template referansı: [`docs/shopify-template-README.md`](./docs/shopify-template-README.md)
